// supabase/functions/revenuecat-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  product_id: string;
  id: string;
  expiration_at_ms: number | null;
};

type CoinPackMap = Record<string, number>;

type WebhookAction =
  | { action: "credit_coins"; coins: number }
  | { action: "set_premium"; expiresAtMs: number }
  | { action: "expire_premium" }
  | { action: "log_only" }
  | { action: "none" };

// Pure and dependency-free so it's easy to read and reason about
// independently of the HTTP/DB plumbing around it, even without an
// automated test runner for this workspace today.
export function mapEventToAction(
  event: RevenueCatEvent,
  coinPackProducts: CoinPackMap,
  premiumProductId: string,
): WebhookAction {
  if (event.type === "NON_RENEWING_PURCHASE") {
    const coins = coinPackProducts[event.product_id];
    return coins ? { action: "credit_coins", coins } : { action: "none" };
  }

  const isPremiumProduct = event.product_id === premiumProductId;

  if (
    isPremiumProduct &&
    ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"].includes(event.type) &&
    event.expiration_at_ms !== null
  ) {
    return { action: "set_premium", expiresAtMs: event.expiration_at_ms };
  }

  // Not CANCELLATION: cancelling only stops future renewal, access
  // continues until the subscription actually expires.
  if (isPremiumProduct && event.type === "EXPIRATION") {
    return { action: "expire_premium" };
  }

  // Logged for observability but no state change — cancelling a coin
  // pack (a refund) is deliberately not reversed here; see this plan's
  // Global Constraints.
  if (isPremiumProduct && (event.type === "CANCELLATION" || event.type === "BILLING_ISSUE")) {
    return { action: "log_only" };
  }

  return { action: "none" };
}

// Inserts the transactions row that marks an event as processed BEFORE
// any profile mutation happens, so the atomicity boundary is the
// database's own unique index on `transactions.reference`
// (see migration 20260727090000) rather than a separate read-then-act
// check. Two concurrent deliveries of the same event both attempt this
// insert; only one can win, and the loser gets a 23505 (unique
// violation) back from Postgres instead of racing ahead to mutate
// profiles a second time.
async function recordTransactionOnce(
  supabase: ReturnType<typeof createClient>,
  row: {
    user_id: string;
    transaction_type: string;
    amount: number;
    coins_delta?: number;
    reference: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("transactions").insert(row);
  if (error) {
    if (error.code === "23505") {
      return false; // duplicate delivery of an already-processed event
    }
    throw error;
  }
  return true;
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) {
    return false;
  }
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=") as [string, string]),
  );
  const timestamp = parts["t"];
  const providedSignature = parts["v1"];
  if (!timestamp || !providedSignature) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const computedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (computedSignature.length !== providedSignature.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    diff |= computedSignature.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET")!;
  const isValid = await verifySignature(
    rawBody,
    req.headers.get("X-RevenueCat-Webhook-Signature"),
    secret,
  );
  if (!isValid) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401 });
  }

  let payload: { event: RevenueCatEvent };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
  }

  const event = payload.event;

  // Validate event structure
  if (
    !event ||
    typeof event !== "object" ||
    !event.type ||
    !event.app_user_id ||
    !event.product_id ||
    !event.id
  ) {
    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
  }

  if (event.type === "TEST") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: coinSettingsRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "coin_pack_products")
      .maybeSingle();
    const { data: premiumSettingsRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "premium_product_id")
      .maybeSingle();

    const coinPackProducts = (coinSettingsRow?.value as CoinPackMap | undefined) ?? {};
    const premiumProductId = (premiumSettingsRow?.value as string | undefined) ?? "";

    const action = mapEventToAction(event, coinPackProducts, premiumProductId);

    // Idempotency is enforced by inserting the transactions row FIRST
    // and only performing the profiles mutation if that insert is the
    // one that actually wins the unique index on `reference` (see
    // recordTransactionOnce above). There is no separate read-then-act
    // pre-check here anymore — the insert itself is the atomicity
    // boundary, which is what closes the concurrent-delivery race a
    // plain SELECT-then-INSERT check could not.
    if (action.action === "credit_coins") {
      const isFirstDelivery = await recordTransactionOnce(supabase, {
        user_id: event.app_user_id,
        transaction_type: "coin_purchase",
        amount: action.coins,
        coins_delta: action.coins,
        reference: event.id,
      });
      if (isFirstDelivery) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("coin_balance")
          .eq("id", event.app_user_id)
          .maybeSingle();
        if (profile) {
          await supabase
            .from("profiles")
            .update({ coin_balance: profile.coin_balance + action.coins })
            .eq("id", event.app_user_id);
        }
      }
    } else if (action.action === "set_premium") {
      const isFirstDelivery = await recordTransactionOnce(supabase, {
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
      if (isFirstDelivery) {
        await supabase
          .from("profiles")
          .update({
            is_premium: true,
            premium_expires_at: new Date(action.expiresAtMs).toISOString(),
          })
          .eq("id", event.app_user_id);
      }
    } else if (action.action === "expire_premium") {
      const isFirstDelivery = await recordTransactionOnce(supabase, {
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
      if (isFirstDelivery) {
        await supabase.from("profiles").update({ is_premium: false }).eq("id", event.app_user_id);
      }
    } else if (action.action === "log_only") {
      await recordTransactionOnce(supabase, {
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("revenuecat-webhook error:", err);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
  }
});

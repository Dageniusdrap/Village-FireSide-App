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

    // Check for duplicate delivery (idempotency)
    const { data: existingTransaction } = await supabase
      .from("transactions")
      .select("id")
      .eq("reference", event.id)
      .maybeSingle();

    if (existingTransaction) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (action.action === "credit_coins") {
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
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "coin_purchase",
        amount: action.coins,
        coins_delta: action.coins,
        reference: event.id,
      });
    } else if (action.action === "set_premium") {
      await supabase
        .from("profiles")
        .update({
          is_premium: true,
          premium_expires_at: new Date(action.expiresAtMs).toISOString(),
        })
        .eq("id", event.app_user_id);
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    } else if (action.action === "expire_premium") {
      await supabase.from("profiles").update({ is_premium: false }).eq("id", event.app_user_id);
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    } else if (action.action === "log_only") {
      await supabase.from("transactions").insert({
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

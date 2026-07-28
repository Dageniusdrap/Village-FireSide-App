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
  | { action: "expire_premium"; expiresAtMs: number | null }
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
  // continues until the subscription actually expires. `expiresAtMs` is
  // carried through so apply_revenuecat_event can tell a genuine
  // expiration from a stale one that a later renewal already superseded.
  if (isPremiumProduct && event.type === "EXPIRATION") {
    return { action: "expire_premium", expiresAtMs: event.expiration_at_ms ?? null };
  }

  // Logged for observability but no state change — cancelling a coin
  // pack (a refund) is deliberately not reversed here; see this plan's
  // Global Constraints.
  if (isPremiumProduct && (event.type === "CANCELLATION" || event.type === "BILLING_ISSUE")) {
    return { action: "log_only" };
  }

  return { action: "none" };
}

// Postgres error codes this function has to tell apart from a generic
// failure. 22P02 = invalid text representation (RevenueCat's anonymous
// app user ids look like "$RCAnonymousID:abc123", which can't be cast to
// uuid); 23503 = foreign key violation (a well-formed uuid that isn't
// one of our profiles). Neither is retryable — retrying either forever
// is exactly the 500-loop this guard exists to prevent.
const PG_INVALID_TEXT_REPRESENTATION = "22P02";
const PG_FOREIGN_KEY_VIOLATION = "23503";

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
    // These two lookups decide whether an event maps to a real action at
    // all, so a failed read here must NOT be swallowed: silently falling
    // back to an empty mapping would turn a paid purchase into a
    // no-op "none" action and still answer 200.
    const { data: coinSettingsRow, error: coinSettingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "coin_pack_products")
      .maybeSingle();
    if (coinSettingsError) {
      throw coinSettingsError;
    }
    const { data: premiumSettingsRow, error: premiumSettingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "premium_product_id")
      .maybeSingle();
    if (premiumSettingsError) {
      throw premiumSettingsError;
    }

    const coinPackProducts = (coinSettingsRow?.value as CoinPackMap | undefined) ?? {};
    const premiumProductId = (premiumSettingsRow?.value as string | undefined) ?? "";

    const action = mapEventToAction(event, coinPackProducts, premiumProductId);

    if (action.action === "none") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Everything else goes through one atomic Postgres function: it
    // inserts the transactions row (the idempotency marker, keyed by the
    // unique index on `reference`) and performs the profiles mutation in
    // a single transaction, so the two can never disagree. A replay
    // short-circuits inside the function and reports "already_processed"
    // without touching profiles; a genuine failure raises and rolls both
    // writes back, and is answered with a non-2xx below so RevenueCat
    // retries.
    const expiresAtMs =
      action.action === "set_premium" || action.action === "expire_premium"
        ? action.expiresAtMs
        : null;

    const { data, error } = await supabase.rpc("apply_revenuecat_event", {
      p_user_id: event.app_user_id,
      p_event_id: event.id,
      p_action: action.action,
      p_coins: action.action === "credit_coins" ? action.coins : 0,
      p_expires_at: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    });

    if (error) {
      if (
        error.code === PG_INVALID_TEXT_REPRESENTATION ||
        error.code === PG_FOREIGN_KEY_VIOLATION
      ) {
        // Not a retryable failure: this event names an app_user_id that
        // will never resolve to a profile (an anonymous RevenueCat id, or
        // a deleted/unknown user). Park it with a 200 so RevenueCat stops
        // redelivering, and log loudly enough to reconcile by hand.
        console.error(
          "revenuecat-webhook: unresolvable app_user_id — parking event, manual reconciliation required.",
          JSON.stringify({
            event_id: event.id,
            event_type: event.type,
            product_id: event.product_id,
            app_user_id: event.app_user_id,
            action: action.action,
            pg_code: error.code,
          }),
        );
        return new Response(JSON.stringify({ ok: true, parked: "unresolvable_app_user_id" }), {
          status: 200,
        });
      }
      throw error;
    }

    const result = (data as { result?: string } | null)?.result ?? "unknown";
    console.log(
      `revenuecat-webhook: event ${event.id} (${event.type}) -> ${action.action}: ${result}`,
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    // A 500 here is deliberate: RevenueCat retries non-2xx deliveries,
    // and after the rollback above nothing has been half-applied.
    console.error("revenuecat-webhook error:", err);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
  }
});

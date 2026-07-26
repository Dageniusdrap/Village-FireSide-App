// supabase/functions/unlock-episode/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let episodeId: unknown;
  try {
    const body = await req.json();
    episodeId = body.episode_id;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  if (typeof episodeId !== "string" || !UUID_RE.test(episodeId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const { data, error } = await supabaseService.rpc("unlock_episode", {
      p_user_id: userData.user.id,
      p_episode_id: episodeId,
    });

    if (error) {
      throw error;
    }

    const result = (data as { result: string; balance?: number; price?: number }).result;

    switch (result) {
      case "unlocked":
      case "already_unlocked":
        return jsonResponse({ ok: true }, 200);
      case "insufficient_coins":
        return jsonResponse(
          {
            error: "insufficient_coins",
            balance: (data as { balance: number }).balance,
            price: (data as { price: number }).price,
          },
          402,
        );
      case "not_coin_gated":
        return jsonResponse({ error: "not_coin_gated" }, 400);
      case "not_found":
        return jsonResponse({ error: "not_found" }, 404);
      default:
        return jsonResponse({ error: "internal_error" }, 500);
    }
  } catch (err) {
    console.error("unlock-episode error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});

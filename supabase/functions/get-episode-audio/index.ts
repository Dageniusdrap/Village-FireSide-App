// supabase/functions/get-episode-audio/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 21600; // 6 hours

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  try {
    let userId: string | null = null;
    if (jwt) {
      const { data, error } = await supabaseAnon.auth.getUser(jwt);
      if (!error && data.user) {
        userId = data.user.id;
      }
    }

    const { data: episode, error: episodeError } = await supabaseService
      .from("episodes")
      .select("id, status, access_tier, audio_url")
      .eq("id", episodeId)
      .maybeSingle();

    if (episodeError) throw episodeError;

    if (!episode || episode.status !== "published" || !episode.audio_url) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    let allowed = episode.access_tier === "free";

    if (!allowed && userId) {
      const { data: unlock } = await supabaseService
        .from("unlocks")
        .select("user_id")
        .eq("user_id", userId)
        .eq("episode_id", episodeId)
        .maybeSingle();

      if (unlock) {
        allowed = true;
      } else {
        const { data: profile } = await supabaseService
          .from("profiles")
          .select("is_premium, premium_expires_at")
          .eq("id", userId)
          .maybeSingle();

        if (
          profile?.is_premium &&
          (!profile.premium_expires_at || new Date(profile.premium_expires_at) > new Date())
        ) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return jsonResponse({ error: "locked" }, 403);
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage
      .from("audio-episodes")
      .createSignedUrl(episode.audio_url, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData) {
      throw signedUrlError ?? new Error("failed to create signed url");
    }

    const { error: playsError } = await supabaseService.from("plays").insert({
      user_id: userId,
      episode_id: episodeId,
    });

    if (playsError) {
      console.error("get-episode-audio plays insert error:", playsError);
    }

    return jsonResponse(
      { signedUrl: signedUrlData.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS },
      200,
    );
  } catch (err) {
    console.error("get-episode-audio error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});

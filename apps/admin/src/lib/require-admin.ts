import { createClient } from "@/lib/supabase/server";

export type RequireAdminResult = { ok: true; adminId: string } | { ok: false; message: string };

// A Server Action is its own callable endpoint and gets no protection
// from proxy.ts's route matcher, which only guards page navigation —
// every Server Action that writes anything must check this itself,
// using the caller's own cookie-scoped session (never the service-role
// client, which has no notion of "caller").
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Not signed in." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { ok: false, message: "Not authorized." };
  }

  return { ok: true, adminId: user.id };
}

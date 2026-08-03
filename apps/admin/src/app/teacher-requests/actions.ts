"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

// Both Server Actions below previously relied entirely on proxy.ts's route
// matcher to keep non-admins out — proxy.ts protects page navigation, but a
// Server Action is its own callable endpoint and gets no such protection for
// free. Check admin status here too, using the caller's own cookie-scoped
// session (never the service-role client, which has no notion of "caller").
async function requireAdmin(): Promise<ActionResult> {
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

  return { ok: true };
}

export async function approveTeacherRequest(
  requestId: string,
  userId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  // Service role required here (not the cookie client used for the admin
  // check above): prevent_protected_profile_changes rejects any
  // profiles.role write that isn't running as auth.role() = 'service_role',
  // regardless of RLS or admin status.
  const supabase = createServiceRoleClient();

  // Atomic: profiles.role and teacher_requests.status are updated inside
  // one Postgres transaction (approve_teacher_request_function.sql), so a
  // failure partway through never leaves a profile promoted to 'teacher'
  // with its request still 'pending'.
  const { error } = await supabase.rpc("approve_teacher_request", {
    p_request_id: requestId,
    p_user_id: userId,
  });
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/teacher-requests");
  return { ok: true };
}

export async function rejectTeacherRequest(requestId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  // No service role needed for a reject: teacher_requests_admin_update RLS
  // already allows an admin's own cookie-scoped session to make this write
  // (unlike approve, this never touches profiles.role).
  const supabase = await createClient();

  const { error } = await supabase
    .from("teacher_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/teacher-requests");
  return { ok: true };
}

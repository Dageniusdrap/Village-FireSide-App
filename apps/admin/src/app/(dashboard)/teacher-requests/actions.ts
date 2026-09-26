"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/require-admin";

export type ActionResult = { ok: true } | { ok: false; message: string };

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

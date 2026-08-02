"use server";

import { revalidatePath } from "next/cache";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function approveTeacherRequest(requestId: string, userId: string) {
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
    throw error;
  }

  revalidatePath("/teacher-requests");
}

export async function rejectTeacherRequest(requestId: string) {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("teacher_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (error) {
    throw error;
  }

  revalidatePath("/teacher-requests");
}

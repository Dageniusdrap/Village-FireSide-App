"use server";

import { revalidatePath } from "next/cache";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function approveTeacherRequest(requestId: string, userId: string) {
  const supabase = createServiceRoleClient();

  const { error: roleError } = await supabase
    .from("profiles")
    .update({ role: "teacher" })
    .eq("id", userId);
  if (roleError) {
    throw roleError;
  }

  const { error: statusError } = await supabase
    .from("teacher_requests")
    .update({ status: "approved" })
    .eq("id", requestId);
  if (statusError) {
    throw statusError;
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

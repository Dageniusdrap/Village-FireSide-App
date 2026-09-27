"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function addDestinationMedia(
  destinationId: string,
  mediaUrl: string,
  caption: string | undefined,
  sortOrder: number,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destination_media").insert({
    destination_id: destinationId,
    media_url: mediaUrl,
    media_type: "image",
    caption: caption || null,
    sort_order: sortOrder,
  });
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", destinationId, {
    action: "add_media",
  });
  revalidatePath(`/destinations/${destinationId}/edit`);
  return { ok: true };
}

export async function reorderDestinationMedia(
  updates: { id: string; sortOrder: number }[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  for (const update of updates) {
    const { error } = await supabase
      .from("destination_media")
      .update({ sort_order: update.sortOrder })
      .eq("id", update.id);
    if (error) {
      return { ok: false, message: error.message };
    }
  }

  return { ok: true };
}

export async function deleteDestinationMedia(
  id: string,
  destinationId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destination_media").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", destinationId, {
    action: "delete_media",
  });
  revalidatePath(`/destinations/${destinationId}/edit`);
  return { ok: true };
}

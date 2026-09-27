"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { DestinationInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: DestinationInput) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    region: input.region || null,
    district: input.district || null,
    country: input.country || null,
    best_time_to_visit: input.bestTimeToVisit || null,
    entry_fee_notes: input.entryFeeNotes || null,
    safety_notes: input.safetyNotes || null,
    conservation_notes: input.conservationNotes || null,
    cover_image_url: input.coverImageUrl || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    is_published: input.isPublished,
  };
}

export async function createDestination(
  input: DestinationInput,
): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("destinations")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "create", "destination", data.id, { name: input.name });
  revalidatePath("/destinations");
  return { ok: true, id: data.id };
}

export async function updateDestination(
  id: string,
  input: DestinationInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destinations").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", id, { name: input.name });
  revalidatePath("/destinations");
  return { ok: true };
}

export async function deleteDestination(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destinations").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "destination", id);
  revalidatePath("/destinations");
  return { ok: true };
}

export async function toggleDestinationPublish(
  id: string,
  isPublished: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("destinations")
    .update({ is_published: isPublished })
    .eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, isPublished ? "publish" : "unpublish", "destination", id);
  revalidatePath("/destinations");
  return { ok: true };
}

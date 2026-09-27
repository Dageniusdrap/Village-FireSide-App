"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { SeriesInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: SeriesInput) {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description || null,
    category: input.category || null,
    destination_id: input.destinationId || null,
    cover_image_url: input.coverImageUrl || null,
    is_featured: input.isFeatured,
    is_published: input.isPublished,
  };
}

export async function createSeries(input: SeriesInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("series").insert(toRow(input)).select("id").single();
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "create", "series", data.id, { title: input.title });
  revalidatePath("/series");
  return { ok: true };
}

export async function updateSeries(id: string, input: SeriesInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("series").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "series", id, { title: input.title });
  revalidatePath("/series");
  return { ok: true };
}

export async function deleteSeries(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("series").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "series", id);
  revalidatePath("/series");
  return { ok: true };
}

export async function toggleSeriesPublish(id: string, isPublished: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("series")
    .update({ is_published: isPublished })
    .eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, isPublished ? "publish" : "unpublish", "series", id);
  revalidatePath("/series");
  return { ok: true };
}

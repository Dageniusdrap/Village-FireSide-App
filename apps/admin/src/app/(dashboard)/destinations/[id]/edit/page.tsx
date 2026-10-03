// apps/admin/src/app/(dashboard)/destinations/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DestinationForm } from "../../destination-form";
import { MediaGallery } from "../../media-gallery";

export default async function EditDestinationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [destinationResult, mediaResult] = await Promise.all([
    supabase
      .from("destinations")
      .select(
        "id, name, slug, description, region, district, country, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes, cover_image_url, latitude, longitude, is_published",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("destination_media")
      .select("id, media_url, caption, sort_order")
      .eq("destination_id", id)
      .order("sort_order"),
  ]);

  if (destinationResult.error || !destinationResult.data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Edit Destination</h1>
      <DestinationForm destination={destinationResult.data} />
      <MediaGallery destinationId={id} media={mediaResult.data ?? []} />
    </div>
  );
}

import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SeriesForm } from "../../series-form";

export default async function EditSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [seriesResult, destinationsResult] = await Promise.all([
    supabase
      .from("series")
      .select(
        "id, title, slug, description, category, destination_id, cover_image_url, is_featured, is_published",
      )
      .eq("id", id)
      .single(),
    supabase.from("destinations").select("id, name").order("name"),
  ]);

  if (seriesResult.error || !seriesResult.data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Series</h1>
      <SeriesForm series={seriesResult.data} destinations={destinationsResult.data ?? []} />
    </div>
  );
}

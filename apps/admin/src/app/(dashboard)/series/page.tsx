import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { SeriesTable } from "./series-table";

export default async function SeriesPage() {
  const supabase = await createClient();
  const { data: series, error } = await supabase
    .from("series")
    .select(
      "id, title, slug, description, category, destination_id, cover_image_url, is_featured, is_published",
    )
    .order("title", { ascending: true });

  if (error) {
    return <p className="text-red-600">Failed to load series: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Series</h1>
        <Link href="/series/new">
          <Button>New Series</Button>
        </Link>
      </div>
      <SeriesTable series={series} />
    </div>
  );
}

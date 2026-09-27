// apps/admin/src/app/(dashboard)/destinations/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { DestinationTable } from "./destination-table";

export default async function DestinationsPage() {
  const supabase = await createClient();
  const { data: destinations, error } = await supabase
    .from("destinations")
    .select(
      "id, name, slug, description, region, district, country, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes, cover_image_url, latitude, longitude, is_published",
    )
    .order("name", { ascending: true });

  if (error) {
    return <p className="text-red-600">Failed to load destinations: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Destinations</h1>
        <Link href="/destinations/new">
          <Button>New Destination</Button>
        </Link>
      </div>
      <DestinationTable destinations={destinations} />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";

import { SeriesForm } from "../series-form";

export default async function NewSeriesPage() {
  const supabase = await createClient();
  const { data: destinations } = await supabase
    .from("destinations")
    .select("id, name")
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Series</h1>
      <SeriesForm destinations={destinations ?? []} />
    </div>
  );
}

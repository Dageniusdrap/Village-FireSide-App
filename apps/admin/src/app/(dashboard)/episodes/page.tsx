// apps/admin/src/app/(dashboard)/episodes/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { EpisodeTable } from "./episode-table";

export default async function EpisodesPage() {
  const supabase = await createClient();
  const { data: episodes, error } = await supabase
    .from("episodes")
    .select("id, title, status, series(title)")
    .order("title", { ascending: true })
    .returns<{ id: string; title: string; status: string; series: { title: string } | null }[]>();

  if (error) {
    return <p className="text-red-600">Failed to load episodes: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Episodes</h1>
        <Link href="/episodes/new">
          <Button>New Episode</Button>
        </Link>
      </div>
      <EpisodeTable episodes={episodes} />
    </div>
  );
}

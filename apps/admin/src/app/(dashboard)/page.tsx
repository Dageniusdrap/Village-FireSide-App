import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [seriesCount, publishedSeriesCount, episodeCount, publishedEpisodeCount] =
    await Promise.all([
      supabase.from("series").select("*", { count: "exact", head: true }),
      supabase.from("series").select("*", { count: "exact", head: true }).eq("is_published", true),
      supabase.from("episodes").select("*", { count: "exact", head: true }),
      supabase
        .from("episodes")
        .select("*", { count: "exact", head: true })
        .eq("status", "published"),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Series</p>
          <p className="text-2xl font-semibold">{seriesCount.count ?? 0}</p>
          <p className="text-xs text-gray-400">{publishedSeriesCount.count ?? 0} published</p>
        </div>
        <div className="rounded border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Episodes</p>
          <p className="text-2xl font-semibold">{episodeCount.count ?? 0}</p>
          <p className="text-xs text-gray-400">{publishedEpisodeCount.count ?? 0} published</p>
        </div>
      </div>
    </div>
  );
}

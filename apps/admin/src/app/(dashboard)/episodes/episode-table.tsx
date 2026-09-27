// apps/admin/src/app/(dashboard)/episodes/episode-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";

import { deleteEpisode } from "./actions";

export type EpisodeListRow = {
  id: string;
  title: string;
  status: string;
  series: { title: string } | null;
};

export function EpisodeTable({ episodes }: { episodes: EpisodeListRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this episode? This cannot be undone.")) {
      return;
    }
    await deleteEpisode(id);
    router.refresh();
  };

  return (
    <DataTable
      rows={episodes}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by title, series, or status…"
      filterRow={(row, query) =>
        row.title.toLowerCase().includes(query) ||
        (row.series?.title ?? "").toLowerCase().includes(query) ||
        row.status.toLowerCase().includes(query)
      }
      columns={[
        { header: "Title", cell: (row) => row.title },
        { header: "Series", cell: (row) => row.series?.title ?? "—" },
        { header: "Status", cell: (row) => row.status },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/episodes/${row.id}/edit`}
                className="text-sm text-blue-700 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleDelete(row.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}

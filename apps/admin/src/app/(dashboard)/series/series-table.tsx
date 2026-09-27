"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/button";
import { DataTable } from "@/components/data-table";

import { deleteSeries, toggleSeriesPublish } from "./actions";
import type { SeriesRow } from "./series-form";

export function SeriesTable({ series }: { series: SeriesRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this series? This cannot be undone.")) {
      return;
    }
    await deleteSeries(id);
    router.refresh();
  };

  const handleTogglePublish = async (row: SeriesRow) => {
    await toggleSeriesPublish(row.id, !row.is_published);
    router.refresh();
  };

  return (
    <DataTable
      rows={series}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by title, category, or slug…"
      filterRow={(row, query) =>
        row.title.toLowerCase().includes(query) ||
        (row.category ?? "").toLowerCase().includes(query) ||
        row.slug.toLowerCase().includes(query)
      }
      columns={[
        { header: "Title", cell: (row) => row.title },
        { header: "Category", cell: (row) => row.category ?? "—" },
        { header: "Slug", cell: (row) => row.slug },
        { header: "Status", cell: (row) => (row.is_published ? "Published" : "Draft") },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/series/${row.id}/edit`}
                className="text-sm text-blue-700 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleTogglePublish(row)}
                className="text-sm text-blue-700 hover:underline"
              >
                {row.is_published ? "Unpublish" : "Publish"}
              </button>
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

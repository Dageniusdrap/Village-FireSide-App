// apps/admin/src/app/(dashboard)/destinations/destination-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";

import { deleteDestination, toggleDestinationPublish } from "./actions";
import type { DestinationRow } from "./destination-form";

export function DestinationTable({ destinations }: { destinations: DestinationRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this destination? This cannot be undone.")) {
      return;
    }
    await deleteDestination(id);
    router.refresh();
  };

  const handleTogglePublish = async (row: DestinationRow) => {
    await toggleDestinationPublish(row.id, !row.is_published);
    router.refresh();
  };

  return (
    <DataTable
      rows={destinations}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by name, region, or country…"
      filterRow={(row, query) =>
        row.name.toLowerCase().includes(query) ||
        (row.region ?? "").toLowerCase().includes(query) ||
        (row.country ?? "").toLowerCase().includes(query)
      }
      columns={[
        { header: "Name", cell: (row) => row.name },
        { header: "Region", cell: (row) => row.region ?? "—" },
        { header: "Country", cell: (row) => row.country ?? "—" },
        { header: "Status", cell: (row) => (row.is_published ? "Published" : "Draft") },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/destinations/${row.id}/edit`}
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

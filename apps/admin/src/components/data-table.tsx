"use client";

import { useState } from "react";

import { TextInput } from "@/components/text-input";

export type DataTableColumn<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchPlaceholder: string;
  /** Returns true if `row` matches `query` (already lowercased by this component). */
  filterRow: (row: T, query: string) => boolean;
  getRowKey: (row: T) => string;
};

export function DataTable<T>({
  columns,
  rows,
  searchPlaceholder,
  filterRow,
  getRowKey,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const lowerQuery = query.trim().toLowerCase();
  const filteredRows = lowerQuery ? rows.filter((row) => filterRow(row, lowerQuery)) : rows;

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      {filteredRows.length === 0 ? (
        <p className="text-gray-500">No results.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              {columns.map((column) => (
                <th key={column.header} className="py-2">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={getRowKey(row)} className="border-b">
                {columns.map((column) => (
                  <td key={column.header} className="py-2">
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

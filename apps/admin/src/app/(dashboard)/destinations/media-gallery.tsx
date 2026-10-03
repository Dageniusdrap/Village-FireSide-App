// apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

import {
  addDestinationMedia,
  deleteDestinationMedia,
  reorderDestinationMedia,
} from "./media-actions";

export type DestinationMediaRow = {
  id: string;
  media_url: string;
  caption: string | null;
  sort_order: number;
};

export function MediaGallery({
  destinationId,
  media,
}: {
  destinationId: string;
  media: DestinationMediaRow[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const sorted = [...media].sort((a, b) => a.sort_order - b.sort_order);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const supabase = createClient();
    const path = `destinations/${destinationId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("images").getPublicUrl(path);
    const nextSortOrder = sorted.length > 0 ? sorted[sorted.length - 1]!.sort_order + 1 : 0;
    const result = await addDestinationMedia(
      destinationId,
      data.publicUrl,
      undefined,
      nextSortOrder,
    );
    setUploading(false);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const current = sorted[index]!;
    const target = sorted[targetIndex]!;
    const result = await reorderDestinationMedia([
      { id: current.id, sortOrder: target.sort_order },
      { id: target.id, sortOrder: current.sort_order },
    ]);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this photo? This cannot be undone.")) {
      return;
    }
    const result = await deleteDestinationMedia(id, destinationId);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <span>Photo Gallery</span>
      <ul className="flex flex-col gap-2">
        {sorted.map((item, index) => (
          <li key={item.id} className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only upload preview, not app content */}
            <img src={item.media_url} alt={item.caption ?? ""} className="h-16 w-16 object-cover" />
            <span className="text-sm text-gray-600">{item.caption ?? "—"}</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => void handleMove(index, -1)}
                disabled={index === 0}
                className="text-sm text-blue-700 hover:underline disabled:opacity-30"
              >
                Move Up
              </button>
              <button
                onClick={() => void handleMove(index, 1)}
                disabled={index === sorted.length - 1}
                className="text-sm text-blue-700 hover:underline disabled:opacity-30"
              >
                Move Down
              </button>
              <button
                onClick={() => void handleDelete(item.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1">
        Add Photo
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
          }}
        />
      </label>
      {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
    </div>
  );
}

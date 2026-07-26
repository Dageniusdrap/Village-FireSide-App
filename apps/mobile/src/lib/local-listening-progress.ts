import { File, Paths } from "expo-file-system";

import { supabase } from "@/lib/supabase";

export type LocalProgress = { positionSeconds: number; updatedAt: string };
type ServerProgress = { positionSeconds: number; updatedAt: string };
type ProgressFile = Record<string, LocalProgress>;

const progressFile = new File(Paths.document, "listening-progress.json");

function readAll(): ProgressFile {
  if (!progressFile.exists) {
    return {};
  }
  try {
    return JSON.parse(progressFile.textSync()) as ProgressFile;
  } catch {
    return {};
  }
}

function writeAll(data: ProgressFile): void {
  if (!progressFile.exists) {
    progressFile.create();
  }
  progressFile.write(JSON.stringify(data));
}

export function readLocalProgress(episodeId: string): LocalProgress | null {
  return readAll()[episodeId] ?? null;
}

export function writeLocalProgress(episodeId: string, positionSeconds: number): void {
  const all = readAll();
  all[episodeId] = { positionSeconds, updatedAt: new Date().toISOString() };
  writeAll(all);
}

/**
 * A stale server row (progress made on another device, then this device
 * played further before losing connectivity) never regresses a fresher
 * local one, and vice versa.
 */
export function resolveResumePosition(
  local: LocalProgress | null,
  server: ServerProgress | null,
): number {
  if (!local && !server) {
    return 0;
  }
  if (!local) {
    return server!.positionSeconds;
  }
  if (!server) {
    return local.positionSeconds;
  }
  return new Date(local.updatedAt) >= new Date(server.updatedAt)
    ? local.positionSeconds
    : server.positionSeconds;
}

/**
 * Always writes locally (guest or signed-in). Only signed-in users
 * additionally upsert to `listening_progress` — a real composite-PK
 * upsert, since that table's primary key is the plain
 * `(user_id, episode_id)` pair (unlike `favorites`' partial-index
 * workaround).
 */
export async function persistListeningProgress(
  episodeId: string,
  positionSeconds: number,
  durationSeconds: number,
  userId: string | null,
): Promise<void> {
  writeLocalProgress(episodeId, positionSeconds);

  if (!userId) {
    return;
  }

  const completed = durationSeconds > 0 && positionSeconds / durationSeconds >= 0.95;
  const { error } = await supabase.from("listening_progress").upsert(
    {
      user_id: userId,
      episode_id: episodeId,
      position_seconds: Math.floor(positionSeconds),
      completed,
    },
    { onConflict: "user_id,episode_id" },
  );

  if (error) {
    console.error("persistListeningProgress upsert error:", error);
  }
}

// apps/mobile/src/lib/downloads-db.ts
import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("downloads.db");

db.execSync(`
  CREATE TABLE IF NOT EXISTS downloads (
    episode_id TEXT PRIMARY KEY NOT NULL,
    series_id TEXT NOT NULL,
    title TEXT NOT NULL,
    series_title TEXT NOT NULL,
    local_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    downloaded_at TEXT NOT NULL
  )
`);

export type DownloadRecord = {
  episodeId: string;
  seriesId: string;
  title: string;
  seriesTitle: string;
  localPath: string;
  fileSize: number;
  downloadedAt: string;
};

type DownloadRow = {
  episode_id: string;
  series_id: string;
  title: string;
  series_title: string;
  local_path: string;
  file_size: number;
  downloaded_at: string;
};

function fromRow(row: DownloadRow): DownloadRecord {
  return {
    episodeId: row.episode_id,
    seriesId: row.series_id,
    title: row.title,
    seriesTitle: row.series_title,
    localPath: row.local_path,
    fileSize: row.file_size,
    downloadedAt: row.downloaded_at,
  };
}

export function insertDownload(record: DownloadRecord): void {
  db.runSync(
    `INSERT OR REPLACE INTO downloads
       (episode_id, series_id, title, series_title, local_path, file_size, downloaded_at)
     VALUES ($episode_id, $series_id, $title, $series_title, $local_path, $file_size, $downloaded_at)`,
    {
      $episode_id: record.episodeId,
      $series_id: record.seriesId,
      $title: record.title,
      $series_title: record.seriesTitle,
      $local_path: record.localPath,
      $file_size: record.fileSize,
      $downloaded_at: record.downloadedAt,
    },
  );
}

export function deleteDownload(episodeId: string): void {
  db.runSync(`DELETE FROM downloads WHERE episode_id = $episode_id`, {
    $episode_id: episodeId,
  });
}

export function getDownload(episodeId: string): DownloadRecord | null {
  const row = db.getFirstSync<DownloadRow>(
    `SELECT * FROM downloads WHERE episode_id = $episode_id`,
    { $episode_id: episodeId },
  );
  return row ? fromRow(row) : null;
}

export function getAllDownloads(): DownloadRecord[] {
  const rows = db.getAllSync<DownloadRow>(`SELECT * FROM downloads ORDER BY downloaded_at DESC`);
  return rows.map(fromRow);
}

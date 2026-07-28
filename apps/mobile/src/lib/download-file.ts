import { Directory, File, Paths } from "expo-file-system";

// downloads-db.ts stores `localPath` bare (no `file://` prefix — the
// same contract player-store.ts's local-source branch already depends
// on). The File/Directory classes need a real URI, so this is the one
// place that prefix gets added back.
export function toFileUri(bareOrUri: string): string {
  return bareOrUri.startsWith("file://") ? bareOrUri : `file://${bareOrUri}`;
}

function toBarePath(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

function getDownloadsDirectory(): Directory {
  const dir = new Directory(Paths.document, "downloads");
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

function extensionFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const match = /\.[a-zA-Z0-9]+$/.exec(pathname);
  return match ? match[0] : ".m4a";
}

export async function downloadEpisodeFile(
  episodeId: string,
  url: string,
  onProgress: (fraction: number) => void,
): Promise<{ localPath: string; fileSize: number }> {
  const dir = getDownloadsDirectory();
  const tempFile = new File(dir, `${episodeId}.tmp`);
  const task = File.createDownloadTask(url, tempFile, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) {
        onProgress(bytesWritten / totalBytes);
      }
    },
  });

  const downloaded = await task.downloadAsync();
  if (!downloaded) {
    throw new Error(`Failed to download episode ${episodeId}`);
  }

  const finalFile = new File(dir, `${episodeId}${extensionFromUrl(url)}`);
  if (finalFile.exists) {
    finalFile.delete();
  }
  // .move() updates `downloaded`'s own `.uri` in place to point at the
  // new location — read `.uri`/`.size` off `downloaded` afterward, not
  // off `finalFile`.
  await downloaded.move(finalFile);

  return { localPath: toBarePath(downloaded.uri), fileSize: downloaded.size };
}

export function deleteEpisodeFile(localPath: string): void {
  const file = new File(toFileUri(localPath));
  if (file.exists) {
    file.delete();
  }
}

// Foreground-only downloads (Global Constraints) mean the in-memory
// queue is always empty right after a cold start — any ".tmp" file
// found at startup is necessarily a leftover from a session that was
// killed mid-download, safe to delete unconditionally.
export function cleanupOrphanedDownloads(): void {
  const dir = getDownloadsDirectory();
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith(".tmp")) {
      entry.delete();
    }
  }
}

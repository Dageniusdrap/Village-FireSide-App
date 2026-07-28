import { File } from "expo-file-system";

import { deleteDownload, getDownload } from "@/lib/downloads-db";
import { toFileUri } from "@/lib/download-file";

// Self-healing: if the OS ever evicts a downloaded file out from under
// the app (low device storage, etc.), the stale DB row is cleaned up
// here rather than the player getting a dangling path back.
export async function getLocalDownloadPath(episodeId: string): Promise<string | null> {
  const record = getDownload(episodeId);
  if (!record) {
    return null;
  }
  const file = new File(toFileUri(record.localPath));
  if (!file.exists) {
    deleteDownload(episodeId);
    return null;
  }
  return record.localPath;
}

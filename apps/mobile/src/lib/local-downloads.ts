// Prompt 10 replaces this function's body with a real lookup against
// downloaded files (expo-file-system). Prompt 8 stubs it so
// resolveEpisodeSource's seam exists without building the download
// mechanism itself.
export async function getLocalDownloadPath(_episodeId: string): Promise<string | null> {
  return null;
}

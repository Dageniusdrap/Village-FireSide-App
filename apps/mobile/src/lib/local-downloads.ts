// Prompt 10 replaces this function's body with a real lookup against
// downloaded files (expo-file-system). Prompt 8 stubs it so
// resolveEpisodeSource's seam exists without building the download
// mechanism itself. When implemented, this must return a bare filesystem
// path (no `file://` prefix) — player-store.ts's loadTrackAtIndex already
// prepends `file://` itself when building the audio source for a local
// result.
export async function getLocalDownloadPath(_episodeId: string): Promise<string | null> {
  return null;
}

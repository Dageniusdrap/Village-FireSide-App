export function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "—";
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

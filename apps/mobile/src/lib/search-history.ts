import { File, Paths } from "expo-file-system";

const MAX_HISTORY = 10;

const historyFile = new File(Paths.document, "search-history.json");

export function readSearchHistory(): string[] {
  if (!historyFile.exists) {
    return [];
  }
  try {
    const parsed = JSON.parse(historyFile.textSync()) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeSearchHistory(queries: string[]): void {
  if (!historyFile.exists) {
    historyFile.create();
  }
  historyFile.write(JSON.stringify(queries.slice(0, MAX_HISTORY)));
}

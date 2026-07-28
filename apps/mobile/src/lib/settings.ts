import { File, Paths } from "expo-file-system";

export type Settings = { wifiOnlyDownloads: boolean };

const DEFAULT_SETTINGS: Settings = { wifiOnlyDownloads: true };

const settingsFile = new File(Paths.document, "settings.json");

export function readSettings(): Settings {
  if (!settingsFile.exists) {
    return DEFAULT_SETTINGS;
  }
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(settingsFile.textSync()) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Settings): void {
  if (!settingsFile.exists) {
    settingsFile.create();
  }
  settingsFile.write(JSON.stringify(settings));
}

import { File, Paths } from "expo-file-system";

const flagFile = new File(Paths.document, "notification-prompt-flag.json");

export function hasPromptedForNotifications(): boolean {
  if (!flagFile.exists) {
    return false;
  }
  try {
    return (JSON.parse(flagFile.textSync()) as { prompted?: boolean }).prompted === true;
  } catch {
    return false;
  }
}

export function markPromptedForNotifications(): void {
  if (!flagFile.exists) {
    flagFile.create();
  }
  flagFile.write(JSON.stringify({ prompted: true }));
}

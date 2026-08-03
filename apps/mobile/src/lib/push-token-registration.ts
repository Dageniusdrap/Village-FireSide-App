import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

export async function registerPushToken(userId: string): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
      },
      { onConflict: "user_id,expo_push_token" },
    );
    if (error) {
      throw error;
    }
  } catch {
    // Best-effort background registration — a failure here (no EAS project
    // configured yet, device offline, etc.) should never surface to the
    // user or crash anything. See docs/known-issues.md.
  }
}

export async function requestNotificationPermissionAndRegister(userId: string): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === "granted") {
      await registerPushToken(userId);
    }
  } catch {
    // Best-effort — see registerPushToken above.
  }
}

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

export async function registerPushToken(userId: string): Promise<void> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  await supabase.from("push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform: Platform.OS,
    },
    { onConflict: "user_id,expo_push_token" },
  );
}

export async function requestNotificationPermissionAndRegister(userId: string): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === "granted") {
    await registerPushToken(userId);
  }
}

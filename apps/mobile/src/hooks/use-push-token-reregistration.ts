import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { registerPushToken } from "@/lib/push-token-registration";

export function usePushTokenReregistration(userId: string | null) {
  useEffect(() => {
    if (!userId) {
      return;
    }
    void Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === "granted") {
        void registerPushToken(userId);
      }
    });
  }, [userId]);
}

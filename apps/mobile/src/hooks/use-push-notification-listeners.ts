import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

export function usePushNotificationListeners() {
  const router = useRouter();

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      // Foreground receipt — no action needed here. Note: per the versioned
      // SDK docs (docs.expo.dev/versions/v57.0.0/sdk/notifications), the
      // default behavior when no Notifications.setNotificationHandler(...)
      // is registered is for the OS to NOT display a banner for a
      // notification received while the app is foregrounded (not "OS
      // default banner" as one might assume) — the notification is simply
      // suppressed. Configuring a custom in-app foreground presentation via
      // setNotificationHandler is out of scope for this task; tap-driven
      // deep-linking (below) is unaffected since it fires from the tray/
      // lock screen regardless of foreground handler configuration.
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const episodeId = response.notification.request.content.data?.episodeId;
        if (typeof episodeId === "string") {
          router.push(`/episode/${episodeId}`);
        }
      },
    );

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [router]);
}

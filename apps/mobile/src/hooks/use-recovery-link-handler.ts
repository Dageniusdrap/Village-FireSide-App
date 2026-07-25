import * as Linking from "expo-linking";
import { useEffect } from "react";

import { parseRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

async function handleUrl(url: string): Promise<void> {
  const result = parseRecoveryLink(url);
  if (!result) {
    return;
  }

  const { error } =
    result.kind === "code"
      ? await supabase.auth.exchangeCodeForSession(result.code)
      : await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });

  if (!error) {
    useAuthStore.getState()._setPasswordRecovery(true);
  }
}

export function useRecoveryLinkHandler(): void {
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) {
        void handleUrl(url);
      }
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, []);
}

import { useCallback, useState } from "react";

import { useAuthStore } from "@/stores/auth-store";

export function useRequireAuth() {
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const [promptVisible, setPromptVisible] = useState(false);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (session) {
        action();
        return;
      }
      if (guestMode) {
        setPromptVisible(true);
      }
    },
    [session, guestMode],
  );

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  return { requireAuth, promptVisible, dismissPrompt };
}

import { useEffect } from "react";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function useAuthListener(): void {
  useEffect(() => {
    const setSession = useAuthStore.getState()._setSession;
    const setLoading = useAuthStore.getState()._setLoading;
    const setPasswordRecovery = useAuthStore.getState()._setPasswordRecovery;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      }
      setSession(session);
      setLoading(false);
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);
}

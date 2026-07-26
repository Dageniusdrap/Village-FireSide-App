import { useEffect, useRef } from "react";
import Purchases from "react-native-purchases";

import { useAuthStore } from "@/stores/auth-store";

// Keeps RevenueCat's "App User ID" equal to our own Supabase user id, so
// revenuecat-webhook's app_user_id can be treated as profiles.id
// directly. Calling Purchases.logOut() while the SDK has never been
// logged in throws LOG_OUT_ANONYMOUS_USER_ERROR (verified against
// RevenueCat's current error-code list) — hasLoggedInRef guards against
// that, so a guest's cold start (the common case) never calls logOut().
export function useSyncPurchasesIdentity() {
  const loading = useAuthStore((state) => state.loading);
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const hasLoggedInRef = useRef(false);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (userId) {
      hasLoggedInRef.current = true;
      Purchases.logIn(userId).catch((error: unknown) => {
        console.warn("Purchases.logIn failed:", error);
      });
    } else if (hasLoggedInRef.current) {
      hasLoggedInRef.current = false;
      Purchases.logOut().catch((error: unknown) => {
        console.warn("Purchases.logOut failed:", error);
      });
    }
  }, [loading, userId]);
}

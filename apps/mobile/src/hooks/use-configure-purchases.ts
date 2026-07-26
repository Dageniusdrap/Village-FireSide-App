import { useEffect } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";

// Configures the RevenueCat SDK once, anonymously (RevenueCat assigns
// its own auto-generated anonymous id) — real user identity is synced
// separately by useSyncPurchasesIdentity once auth state is known.
export function useConfigurePurchases() {
  useEffect(() => {
    const apiKey =
      Platform.OS === "ios"
        ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
    if (!apiKey) {
      console.warn(`Missing RevenueCat API key for platform "${Platform.OS}"`);
      return;
    }
    Purchases.configure({ apiKey });
  }, []);
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Purchases, { type PurchasesPackage } from "react-native-purchases";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";

export default function CoinsScreen() {
  const queryClient = useQueryClient();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Purchases.getOfferings()
      .then((offerings) => {
        if (!cancelled) {
          setPackages(offerings.current?.availablePackages ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setPurchasingId(pkg.identifier);
    try {
      await Purchases.purchasePackage(pkg);
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      Alert.alert("Success", "Your purchase is complete.");
    } catch (error) {
      const purchasesError = error as { userCancelled?: boolean };
      if (!purchasesError.userCancelled) {
        Alert.alert("Purchase failed", "Something went wrong. Please try again.");
      }
    } finally {
      setPurchasingId(null);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await Purchases.restorePurchases();
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      Alert.alert("Restored", "Your purchases have been restored.");
    } catch {
      Alert.alert("Restore failed", "Something went wrong. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Coins & Premium</ThemedText>

        {loadError ? (
          <EmptyState title="Couldn't load products" body="Check your connection and try again." />
        ) : packages === null ? (
          <Skeleton width="100%" height={200} />
        ) : packages.length === 0 ? (
          <EmptyState
            title="No products available"
            body="Products haven't been configured yet — check back soon."
          />
        ) : (
          packages.map((pkg) => (
            <Card key={pkg.identifier} style={styles.productCard}>
              <ThemedText type="smallBold">{pkg.product.title}</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {pkg.product.description}
              </ThemedText>
              <Button
                label={pkg.product.priceString}
                onPress={() => void handlePurchase(pkg)}
                loading={purchasingId === pkg.identifier}
                disabled={purchasingId !== null}
              />
            </Card>
          ))
        )}

        <Pressable onPress={() => void handleRestore()} disabled={restoring}>
          <ThemedText type="linkPrimary">
            {restoring ? "Restoring…" : "Restore Purchases"}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  productCard: {
    gap: Spacing.two,
  },
});

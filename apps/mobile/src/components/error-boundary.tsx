import * as Updates from "expo-updates";
import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// "Restart" calls Updates.reloadAsync() — a full JS-context reload —
// not a re-mount of `children`. Zustand stores are module-level
// singletons living outside React's tree, so re-mounting alone would
// not reset any of them; a genuine state-corruption bug would
// immediately re-crash. A full reload resets all in-memory store
// state. This codebase's real local-persistence convention
// (lib/settings.ts, lib/search-history.ts, lib/notification-permission-flag.ts)
// already wraps every read in try/catch with a safe-default fallback,
// so a reload is unlikely to immediately repeat-crash from corrupted
// *persisted* data — the one part of this not independently verified
// is Supabase's own session storage (secure-store-adapter.ts, internal
// to supabase-js), which is assumed (not confirmed here) to treat a
// malformed stored session as "no session" rather than throwing.
//
// Per the versioned SDK 57 docs (docs.expo.dev/versions/v57.0.0/sdk/updates/)
// and this package's own type declarations, reloadAsync() cannot be used
// in Expo Go or development mode (or when expo-updates is disabled) and
// its returned promise *rejects* in those cases. The `.catch` below is
// required so that hitting "Restart" in a dev build doesn't surface an
// unhandled promise rejection — there is nothing more useful to do here
// since the user has already seen the fallback UI.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  handleRestart = () => {
    Updates.reloadAsync().catch(() => {
      // No-op: rejects in Expo Go / development mode / when
      // expo-updates is disabled. Nothing more to do from here.
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <ThemedView style={styles.container}>
            <ThemedText type="title">Something went wrong</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Please restart the app.
            </ThemedText>
            <Pressable
              onPress={this.handleRestart}
              accessibilityRole="button"
              accessibilityLabel="Restart"
            >
              <ThemedText type="default" themeColor="accent">
                Restart
              </ThemedText>
            </Pressable>
          </ThemedView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.four,
  },
});

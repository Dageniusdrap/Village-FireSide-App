import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function SignInPromptSheet({
  visible,
  onDismiss,
  onSignIn,
  onSignUp,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={Spacing.two}
      >
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Sign in to continue</ThemedText>
          <ThemedText type="default">
            Create a free account or sign in to save your progress.
          </ThemedText>
          <Pressable
            style={styles.primaryButton}
            onPress={onSignIn}
            accessibilityRole="button"
            accessibilityLabel="Sign In"
            hitSlop={Spacing.two}
          >
            <ThemedText type="default" themeColor="background">
              Sign In
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={onSignUp}
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            hitSlop={Spacing.two}
          >
            <ThemedText type="linkPrimary">Create Account</ThemedText>
          </Pressable>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
});

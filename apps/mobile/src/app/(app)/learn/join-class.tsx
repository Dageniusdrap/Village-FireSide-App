// apps/mobile/src/app/(app)/learn/join-class.tsx
import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useJoinClass } from "@/hooks/queries/use-join-class";

export default function JoinClassScreen() {
  const { joinClass } = useJoinClass();
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();
  const [joinedClassName, setJoinedClassName] = useState<string | undefined>();

  const onJoin = async () => {
    if (!joinCode.trim()) {
      return;
    }
    setIsJoining(true);
    setApiError(undefined);
    try {
      const result = await joinClass({ joinCode: joinCode.trim() });
      setJoinedClassName(result.className);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "That code didn't work.");
    }
    setIsJoining(false);
  };

  if (joinedClassName) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <BackButton />
          <ThemedText type="title">You joined {joinedClassName}</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <ThemedText type="title">Join a Class</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Class code"
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="characters"
        />
        {apiError ? (
          <ThemedText type="small" themeColor="text" style={styles.error}>
            {apiError}
          </ThemedText>
        ) : null}
        <Button
          label={isJoining ? "Joining…" : "Join"}
          onPress={onJoin}
          disabled={isJoining || !joinCode.trim()}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  error: {
    color: "#C0392B",
  },
});

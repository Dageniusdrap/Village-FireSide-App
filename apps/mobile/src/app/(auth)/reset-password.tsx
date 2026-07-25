import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type ResetPasswordInput, resetPasswordSchema } from "@/lib/validation";
import { useAuthStore } from "@/stores/auth-store";

export default function ResetPasswordScreen() {
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery);
  const [apiError, setApiError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });

  const onSubmit = async (values: ResetPasswordInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setApiError(error.message);
      return;
    }
    useAuthStore.getState()._setPasswordRecovery(false);
    setDone(true);
  };

  if (!passwordRecovery) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Link expired</ThemedText>
          <ThemedText type="default">
            This password reset link is no longer valid — request a new one from the Sign In screen.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (done) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Password updated</ThemedText>
          <ThemedText type="default">
            You&apos;re all set — you can now sign in with your new password.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Set a New Password</ThemedText>

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="New password"
              secureTextEntry
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.password?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Saving…" : "Save Password"}
          </ThemedText>
        </Pressable>
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
    justifyContent: "center",
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
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
});

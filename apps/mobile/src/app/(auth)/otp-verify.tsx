// apps/mobile/src/app/(auth)/otp-verify.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type OtpVerifyInput, otpVerifySchema } from "@/lib/validation";

const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpVerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [apiError, setApiError] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OtpVerifyInput>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { code: "" },
  });

  useEffect(() => {
    if (cooldown === 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const onSubmit = async (values: OtpVerifyInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: values.code,
      type: "sms",
    });
    if (error) {
      setApiError(error.message);
    }
    // On success, the auth-state-change listener updates the store and the
    // root layout's <Redirect> takes the user to (app) — no navigation call needed here.
  };

  const handleResend = async () => {
    setApiError(undefined);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setApiError(error.message);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Enter the Code</ThemedText>
        <ThemedText type="default">We sent a 6-digit code to {phone}.</ThemedText>

        <Controller
          control={control}
          name="code"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.code?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Verifying…" : "Verify"}
          </ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} disabled={cooldown > 0} onPress={handleResend}>
          <ThemedText type="linkPrimary">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
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
    textAlign: "center",
    letterSpacing: Spacing.two,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
    alignItems: "center",
  },
});

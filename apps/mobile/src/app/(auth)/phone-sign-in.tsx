// apps/mobile/src/app/(auth)/phone-sign-in.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { COUNTRY_CODES, toE164 } from "@/lib/phone";
import { type PhoneSignInInput, phoneSignInSchema } from "@/lib/validation";

export default function PhoneSignInScreen() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneSignInInput>({
    resolver: zodResolver(phoneSignInSchema),
    defaultValues: { dialCode: COUNTRY_CODES[0].dialCode, localNumber: "" },
  });

  const onSubmit = async (values: PhoneSignInInput) => {
    setApiError(undefined);
    const phone = toE164(values.dialCode, values.localNumber);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setApiError(error.message);
      return;
    }
    router.push({ pathname: "/otp-verify", params: { phone } });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title">Phone Sign In</ThemedText>
          <ThemedText type="default">
            Enter your phone number to sign in or create an account.
          </ThemedText>

          <ThemedText type="smallBold">Country</ThemedText>
          <Controller
            control={control}
            name="dialCode"
            render={({ field }) => (
              <ThemedView style={styles.countryList}>
                {COUNTRY_CODES.map((country) => (
                  <Pressable
                    key={country.dialCode}
                    style={[
                      styles.countryOption,
                      field.value === country.dialCode && styles.countryOptionSelected,
                    ]}
                    onPress={() => field.onChange(country.dialCode)}
                  >
                    <ThemedText type="small">
                      {country.name} ({country.dialCode})
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            )}
          />
          <FormError message={errors.dialCode?.message} />

          <Controller
            control={control}
            name="localNumber"
            render={({ field }) => (
              <TextInput
                style={styles.input}
                placeholder="Phone number"
                keyboardType="phone-pad"
                onChangeText={field.onChange}
                value={field.value}
              />
            )}
          />
          <FormError message={errors.localNumber?.message} />
          <FormError message={apiError} />

          <Pressable
            style={styles.primaryButton}
            disabled={isSubmitting}
            onPress={handleSubmit(onSubmit)}
          >
            <ThemedText type="default" themeColor="background">
              {isSubmitting ? "Sending Code…" : "Send Code"}
            </ThemedText>
          </Pressable>
        </ScrollView>
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
  },
  scrollContent: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  countryList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  countryOption: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  countryOptionSelected: {
    borderColor: "#1F3B2C",
    borderWidth: 2,
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

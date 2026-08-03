import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type TeacherRequestInput, teacherRequestSchema } from "@/lib/validation";
import { useAuthStore } from "@/stores/auth-store";

export default function TeacherRequestScreen() {
  const session = useAuthStore((state) => state.session);
  const [apiError, setApiError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TeacherRequestInput>({
    resolver: zodResolver(teacherRequestSchema),
    defaultValues: { name: "", school: "", district: "", phone: "" },
  });

  const onSubmit = async (values: TeacherRequestInput) => {
    if (!session) {
      setApiError("You need to be signed in to request a teacher account.");
      return;
    }
    setApiError(undefined);
    const { error } = await supabase.from("teacher_requests").insert({
      user_id: session.user.id,
      name: values.name,
      school: values.school,
      district: values.district,
      phone: values.phone,
    });
    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setApiError(error.message);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <BackButton />
          <ThemedText type="title">Request sent</ThemedText>
          <ThemedText type="default">
            An admin will review your request. You&apos;ll see teacher tools in the Learn tab once
            it&apos;s approved.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <ThemedText type="title">Request a Teacher Account</ThemedText>

        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Your name"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.name?.message} />

        <Controller
          control={control}
          name="school"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="School name"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.school?.message} />

        <Controller
          control={control}
          name="district"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="District"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.district?.message} />

        <Controller
          control={control}
          name="phone"
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
        <FormError message={errors.phone?.message} />
        <FormError message={apiError} />

        <Button
          label={isSubmitting ? "Sending…" : "Send Request"}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
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
});

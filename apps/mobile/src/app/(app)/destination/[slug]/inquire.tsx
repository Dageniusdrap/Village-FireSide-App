// apps/mobile/src/app/(app)/destination/[slug]/inquire.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useDestinationDetail } from "@/hooks/queries/use-destination-detail";
import { type BookingInquiryInput, bookingInquirySchema } from "@/lib/validation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function BookingInquiryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const destinationQuery = useDestinationDetail(slug);
  const session = useAuthStore((state) => state.session);
  const [apiError, setApiError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [preferredDate, setPreferredDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BookingInquiryInput>({
    resolver: zodResolver(bookingInquirySchema),
    defaultValues: { name: "", phone: "", email: "", preferredDate: "", message: "" },
  });

  if (destinationQuery.isLoading || !destinationQuery.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <Skeleton width="100%" height={100} />
      </SafeAreaView>
    );
  }

  const destination = destinationQuery.data;

  const onSubmit = async (values: BookingInquiryInput) => {
    setApiError(undefined);
    const { error } = await supabase.from("booking_inquiries").insert({
      destination_id: destination.id,
      user_id: session?.user.id ?? null,
      name: values.name,
      phone: values.phone,
      email: values.email || null,
      preferred_date: values.preferredDate || null,
      message: values.message,
    });
    if (error) {
      setApiError(error.message);
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <BackButton />
          <ThemedText type="title">Inquiry sent</ThemedText>
          <ThemedText type="default">A local guide partner will contact you.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackButton />
        <ThemedText type="title">Plan Your Visit</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {destination.name}
        </ThemedText>

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

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.email?.message} />

        <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
          <ThemedText type="default">
            {preferredDate ? preferredDate.toISOString().slice(0, 10) : "Preferred date (optional)"}
          </ThemedText>
        </Pressable>
        {showDatePicker ? (
          <DateTimePicker
            value={preferredDate ?? new Date()}
            mode="date"
            display="default"
            onChange={(_event, date) => {
              setShowDatePicker(false);
              if (date) {
                setPreferredDate(date);
                setValue("preferredDate", date.toISOString().slice(0, 10));
              }
            }}
          />
        ) : null}

        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Tell us about your trip"
              multiline
              numberOfLines={4}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.message?.message} />
        <FormError message={apiError} />

        <Button
          label={isSubmitting ? "Sending…" : "Send Inquiry"}
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
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },
});

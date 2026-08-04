// apps/mobile/src/app/(app)/learn/teacher/index.tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";
import { useClasses, useCreateClass } from "@/hooks/queries/use-classes";

export default function TeacherClassesScreen() {
  const router = useRouter();
  const query = useClasses();
  const { createClass } = useCreateClass();
  const [newClassName, setNewClassName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const onCreate = async () => {
    if (!newClassName.trim()) {
      return;
    }
    setIsCreating(true);
    setApiError(undefined);
    try {
      await createClass({ name: newClassName.trim() });
      setNewClassName("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not create the class.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <View style={styles.content}>
        <SectionHeader title="My Classes" />

        <View style={styles.createRow}>
          <TextInput
            style={styles.input}
            placeholder="New class name"
            value={newClassName}
            onChangeText={setNewClassName}
          />
          <Button
            label={isCreating ? "Creating…" : "Create"}
            onPress={onCreate}
            disabled={isCreating || !newClassName.trim()}
          />
        </View>
        <FormError message={apiError} />

        {query.isLoading ? (
          <Skeleton width="100%" height={100} />
        ) : query.isError ? (
          <EmptyState
            title="Couldn't load classes"
            body="Please try again later."
            onRetry={() => query.refetch()}
          />
        ) : !query.data || query.data.length === 0 ? (
          <EmptyState title="No classes yet" body="Create a class above to get a join code." />
        ) : (
          query.data.map((classItem) => (
            <Pressable
              key={classItem.id}
              style={styles.classRow}
              onPress={() => router.push(`/learn/teacher/class/${classItem.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open class ${classItem.name}`}
              hitSlop={Spacing.two}
            >
              <ThemedText type="default">{classItem.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Code: {classItem.joinCode}
              </ThemedText>
            </Pressable>
          ))
        )}
      </View>
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
  createRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  classRow: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
});

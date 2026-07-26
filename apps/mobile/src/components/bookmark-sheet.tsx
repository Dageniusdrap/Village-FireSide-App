// apps/mobile/src/components/bookmark-sheet.tsx
import { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function BookmarkSheet({
  visible,
  onDismiss,
  onSave,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSave: (note: string | null) => void;
}) {
  const theme = useTheme();
  const [note, setNote] = useState("");

  const handleSave = () => {
    onSave(note.trim().length > 0 ? note.trim() : null);
    setNote("");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Bookmark this moment</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            placeholder="Add a note (optional)"
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <Button label="Save bookmark" onPress={handleSave} />
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    minHeight: 80,
    textAlignVertical: "top",
  },
});

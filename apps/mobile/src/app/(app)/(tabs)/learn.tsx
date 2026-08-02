import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionHeader } from "@/components/ui/section-header";
import { SUBJECT_AREAS } from "@/constants/learn";
import { Spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/queries/use-profile";

export default function LearnScreen() {
  const router = useRouter();
  const profile = useProfile();
  const isTeacher = profile.data?.role === "teacher";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Browse by Subject" />
        <View style={styles.row}>
          {SUBJECT_AREAS.map((subject) => (
            <Chip
              key={subject.value}
              label={subject.label}
              onPress={() => router.push(`/learn/${subject.value}`)}
            />
          ))}
        </View>

        <SectionHeader title="Schools" />
        <View style={styles.stack}>
          {isTeacher ? (
            <Button label="My Classes" onPress={() => router.push("/learn/teacher")} />
          ) : (
            <Button
              label="Request a Teacher Account"
              variant="secondary"
              onPress={() => router.push("/learn/teacher-request")}
            />
          )}
          <Button
            label="Join a Class"
            variant="ghost"
            onPress={() => router.push("/learn/join-class")}
          />
        </View>
      </ScrollView>
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
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  stack: {
    gap: Spacing.two,
  },
});

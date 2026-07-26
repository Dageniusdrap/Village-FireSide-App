import { Slot } from "expo-router";
import { StyleSheet, View } from "react-native";

import { MiniPlayer } from "@/components/ui/mini-player";

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <Slot />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

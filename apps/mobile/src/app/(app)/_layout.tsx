import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AudioStatusDriver } from "@/components/audio-status-driver";
import { MiniPlayer } from "@/components/ui/mini-player";

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="contributor/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="cultural-group/[id]" options={{ headerShown: false }} />
      </Stack>
      <MiniPlayer />
      <AudioStatusDriver />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

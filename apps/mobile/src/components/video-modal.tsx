import { useVideoPlayer, VideoView } from "expo-video";
import { Modal, Pressable, StyleSheet } from "react-native";

export function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, (p) => p.play());

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <VideoView player={player} style={styles.video} nativeControls />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
  },
  video: {
    width: "100%",
    height: 300,
  },
});

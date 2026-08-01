import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet } from "react-native";

import { audioPlayer } from "@/lib/audio-player";

export function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, (p) => p.play());
  const wasAudioPlayingRef = useRef(false);

  useEffect(() => {
    wasAudioPlayingRef.current = audioPlayer.playing;
    if (audioPlayer.playing) {
      audioPlayer.pause();
    }
  }, []);

  const handleClose = () => {
    if (wasAudioPlayingRef.current) {
      audioPlayer.play();
    }
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
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

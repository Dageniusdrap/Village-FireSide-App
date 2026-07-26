import { useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { audioPlayer } from "@/lib/audio-player";
import { persistListeningProgress } from "@/lib/local-listening-progress";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";

// Render-nothing component, mounted once alongside <MiniPlayer />. It
// exists because no native event fires on a 15s tick or a track
// finishing — useAudioPlayerStatus's periodic status object is the only
// signal available, so this is the one place that watches it and drives
// every status-triggered side effect (position saves, auto-advance,
// sleep timer firing).
export function AudioStatusDriver() {
  const status = useAudioPlayerStatus(audioPlayer);
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const sleepTimer = usePlayerStore((state) => state.sleepTimer);
  const next = usePlayerStore((state) => state.next);
  const cancelSleepTimer = usePlayerStore((state) => state.cancelSleepTimer);
  const session = useAuthStore((state) => state.session);

  // Refs mirroring the latest values are updated in effects (not during
  // render, which react-hooks/refs disallows) so the stable 15s interval
  // and other callbacks below never close over stale state.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const episodeRef = useRef(currentEpisode);
  useEffect(() => {
    episodeRef.current = currentEpisode;
  }, [currentEpisode]);
  const userIdRef = useRef(session?.user.id ?? null);
  useEffect(() => {
    userIdRef.current = session?.user.id ?? null;
  }, [session]);

  const saveProgressRef = useRef(() => {
    const episode = episodeRef.current;
    const currentStatus = statusRef.current;
    if (episode && currentStatus.currentTime > 0) {
      void persistListeningProgress(
        episode.id,
        currentStatus.currentTime,
        currentStatus.duration,
        userIdRef.current,
      );
    }
  });

  // 15-second save tick — a stable interval reading the latest status via
  // a ref, so it isn't torn down and rebuilt on every ~500ms status
  // update.
  useEffect(() => {
    const interval = setInterval(() => saveProgressRef.current(), 15000);
    return () => clearInterval(interval);
  }, []);

  // Save immediately on a playing -> paused transition.
  const wasPlayingRef = useRef(status.playing);
  useEffect(() => {
    if (wasPlayingRef.current && !status.playing) {
      saveProgressRef.current();
    }
    wasPlayingRef.current = status.playing;
  }, [status.playing]);

  // Save immediately when the app leaves the foreground (background/kill).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        saveProgressRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  // didJustFinish edges false -> true exactly once per track end.
  const didJustFinishRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !didJustFinishRef.current) {
      didJustFinishRef.current = true;
      if (sleepTimer.mode === "end-of-episode") {
        audioPlayer.pause();
        cancelSleepTimer();
      } else {
        void next();
      }
    } else if (!status.didJustFinish) {
      didJustFinishRef.current = false;
    }
  }, [status.didJustFinish, sleepTimer.mode, next, cancelSleepTimer]);

  // expo-audio's AudioStatus.error is set when something goes wrong
  // mid-playback (an expired signed URL, a network drop, a decode
  // failure) — with nothing watching it, the UI would just show "paused"
  // forever with no explanation. Edge-detected the same way didJustFinish
  // is above, so the toast only fires once per new error rather than on
  // every ~500ms status tick while the same error string persists.
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (status.error && status.error !== lastErrorRef.current) {
      usePlayerStore.setState({ toastMessage: "Playback error — try again." });
    }
    lastErrorRef.current = status.error;
  }, [status.error]);

  return null;
}

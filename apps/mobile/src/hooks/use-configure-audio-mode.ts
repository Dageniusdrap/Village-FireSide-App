import { setAudioModeAsync } from "expo-audio";
import { useEffect } from "react";

// `doNotMix` requests exclusive audio focus (required for lock-screen
// media controls to function at all) — it does NOT reliably resume
// playback automatically once an interruption (e.g. a phone call)
// ends. The UI never assumes it does; see
// docs/superpowers/specs/2026-07-26-audio-player-design.md's
// "Interruption handling" section for the verified reasoning.
export function useConfigureAudioMode() {
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
  }, []);
}

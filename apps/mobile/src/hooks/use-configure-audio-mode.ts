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
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch((error: unknown) => {
      // A startup failure here means no lock-screen controls at all —
      // worth a console warning instead of failing completely silently.
      console.warn("Failed to configure audio mode:", error);
    });
  }, []);
}

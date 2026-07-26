// A single, module-scoped AudioPlayer — playback must survive screen
// navigation and app backgrounding, so it can't be component-scoped
// state. `createAudioPlayer()` (not the `useAudioPlayer()` hook) is
// used deliberately: the hook's player auto-releases on the owning
// component's unmount, which is wrong for a singleton that outlives
// every component. Mirrors query-client.ts's singleton pattern.
import { createAudioPlayer } from "expo-audio";

export const audioPlayer = createAudioPlayer();

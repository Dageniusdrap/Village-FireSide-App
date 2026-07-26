// apps/mobile/src/components/now-playing-overlay.tsx
import { Image } from "expo-image";
import { useAudioPlayerStatus } from "expo-audio";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { BookmarkSheet } from "@/components/bookmark-sheet";
import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Chip } from "@/components/ui/chip";
import { SourceBadge } from "@/components/ui/source-badge";
import { Spacing } from "@/constants/theme";
import { useEpisodeContributor } from "@/hooks/queries/use-episode-contributor";
import { useCreateBookmark } from "@/hooks/queries/use-create-bookmark";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useTheme } from "@/hooks/use-theme";
import { audioPlayer } from "@/lib/audio-player";
import { formatDuration } from "@/lib/format-duration";
import { usePlayerStore } from "@/stores/player-store";

const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 2] as const;
const SLEEP_OPTIONS = [10, 20, 30, 45, "end-of-episode", "off"] as const;

export function NowPlayingOverlay() {
  const theme = useTheme();
  const router = useRouter();
  const expanded = usePlayerStore((state) => state.expanded);
  const collapse = usePlayerStore((state) => state.collapse);
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const playPause = usePlayerStore((state) => state.playPause);
  const seekBy = usePlayerStore((state) => state.seekBy);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setPlaybackRate = usePlayerStore((state) => state.setPlaybackRate);
  const startSleepTimer = usePlayerStore((state) => state.startSleepTimer);
  const cancelSleepTimer = usePlayerStore((state) => state.cancelSleepTimer);
  const sleepTimer = usePlayerStore((state) => state.sleepTimer);

  const status = useAudioPlayerStatus(audioPlayer);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();
  const { createBookmark } = useCreateBookmark();
  const contributorQuery = useEpisodeContributor(currentEpisode?.id ?? null);

  const [bookmarkSheetVisible, setBookmarkSheetVisible] = useState(false);
  const [sleepPickerVisible, setSleepPickerVisible] = useState(false);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const trackWidthRef = useRef(0);

  // panHandlers is memoized (seekTo is a stable zustand action reference,
  // so this effectively only runs once) and spread into the track view's
  // JSX every render, per React Native's documented PanResponder idiom
  // (https://reactnative.dev/docs/panresponder). The handlers below read
  // live data via statusRef/trackWidthRef rather than closed-over
  // render-time values, so they stay correct even though the responder
  // itself isn't recreated on every render.
  //
  // Fractions are computed from `event.nativeEvent.locationX` — coordinates
  // relative to the view that owns the responder (the track) — not
  // `gestureState.moveX`, which is screen-absolute and would be off by the
  // track's horizontal offset within the padded content. `locationX` is
  // also valid on the very first callback (grant), unlike `moveX`, which is
  // only populated once a move event has fired; that's what lets a plain
  // tap-and-release seek to the tapped position instead of falling back to
  // 0. Mirrors MiniPlayer's `handleTrackPress` locationX-based tap-to-seek.
  //
  // react-hooks/refs (a React Compiler-oriented rule shipped in
  // eslint-plugin-react-hooks) flags the closures below for referencing
  // trackWidthRef/statusRef inside a function created during render (the
  // useMemo factory). The closures only ever read `.current` inside their
  // own event-handler bodies — never during render itself — which is
  // React Native's own documented PanResponder idiom
  // (https://reactnative.dev/docs/panresponder); there's no ref-free way
  // to do this with PanResponder.
  /* eslint-disable react-hooks/refs */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (trackWidthRef.current <= 0) {
            return;
          }
          const fraction = Math.min(
            1,
            Math.max(0, event.nativeEvent.locationX / trackWidthRef.current),
          );
          setDragFraction(fraction);
        },
        onPanResponderMove: (event) => {
          if (trackWidthRef.current <= 0) {
            return;
          }
          const fraction = Math.min(
            1,
            Math.max(0, event.nativeEvent.locationX / trackWidthRef.current),
          );
          setDragFraction(fraction);
        },
        onPanResponderRelease: (event) => {
          if (trackWidthRef.current > 0 && statusRef.current.duration > 0) {
            const fraction = Math.min(
              1,
              Math.max(0, event.nativeEvent.locationX / trackWidthRef.current),
            );
            seekTo(fraction * statusRef.current.duration);
          }
          setDragFraction(null);
        },
      }),
    [seekTo],
  );
  /* eslint-enable react-hooks/refs */

  if (!currentEpisode) {
    return null;
  }

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    trackWidthRef.current = event.nativeEvent.layout.width;
  };

  const progress = dragFraction ?? (status.duration > 0 ? status.currentTime / status.duration : 0);
  const displaySeconds =
    dragFraction !== null ? dragFraction * status.duration : status.currentTime;

  const handleBookmarkPress = () => {
    requireAuth(() => setBookmarkSheetVisible(true));
  };

  const handleBookmarkSave = (note: string | null) => {
    setBookmarkSheetVisible(false);
    void createBookmark({
      episodeId: currentEpisode.id,
      positionSeconds: status.currentTime,
      note,
    }).catch(() => {});
  };

  return (
    <Modal visible={expanded} animationType="slide" onRequestClose={collapse}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <Pressable onPress={collapse} style={styles.collapseButton}>
          <ThemedText type="default">▼</ThemedText>
        </Pressable>
        <ScrollView contentContainerStyle={styles.content}>
          {currentEpisode.coverImageUrl ? (
            <Image
              source={{ uri: currentEpisode.coverImageUrl }}
              style={styles.artwork}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.artwork, { backgroundColor: theme.accentSoft }]} />
          )}

          <ThemedText type="small" themeColor="textSecondary">
            {currentEpisode.seriesTitle}
          </ThemedText>
          <ThemedText type="title">{currentEpisode.title}</ThemedText>
          <SourceBadge source={currentEpisode.contentSource} />
          {contributorQuery.data ? (
            <ThemedText type="small" themeColor="textSecondary">
              Told by {contributorQuery.data}
            </ThemedText>
          ) : null}

          <View style={styles.scrubberSection}>
            <View style={styles.track} onLayout={handleTrackLayout} {...panResponder.panHandlers}>
              <View style={[styles.trackBackground, { backgroundColor: theme.border }]} />
              <View
                style={[
                  styles.trackFill,
                  { backgroundColor: theme.accent, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.timeRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(Math.floor(displaySeconds))}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(status.duration > 0 ? Math.floor(status.duration) : null)}
              </ThemedText>
            </View>
          </View>

          <View style={styles.controlsRow}>
            <Pressable onPress={() => void previous()}>
              <ThemedText type="title" style={styles.controlIcon}>
                ⏮
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => seekBy(-15)}>
              <ThemedText type="subtitle" style={styles.controlIcon}>
                ⏪15
              </ThemedText>
            </Pressable>
            <Pressable onPress={playPause}>
              <ThemedText type="title" style={styles.controlIcon}>
                {status.playing ? "⏸" : "▶"}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => seekBy(15)}>
              <ThemedText type="subtitle" style={styles.controlIcon}>
                15⏩
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => void next()}>
              <ThemedText type="title" style={styles.controlIcon}>
                ⏭
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.chipRow}>
            {PLAYBACK_RATES.map((rate) => (
              <Chip
                key={rate}
                label={`${rate}×`}
                selected={status.playbackRate === rate}
                onPress={() => setPlaybackRate(rate)}
              />
            ))}
          </View>

          <View style={styles.actionsRow}>
            <Pressable onPress={handleBookmarkPress}>
              <ThemedText type="default" themeColor="accent">
                🔖 Bookmark
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => setSleepPickerVisible((visible) => !visible)}>
              <ThemedText type="default" themeColor="accent">
                ⏰{" "}
                {sleepTimer.mode === "timer"
                  ? `${sleepTimer.minutes}m`
                  : sleepTimer.mode === "end-of-episode"
                    ? "End of episode"
                    : "Sleep timer"}
              </ThemedText>
            </Pressable>
          </View>

          {sleepPickerVisible ? (
            <ThemedView style={styles.sleepPicker}>
              {SLEEP_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={
                    option === "off"
                      ? "Off"
                      : option === "end-of-episode"
                        ? "End of episode"
                        : `${option} min`
                  }
                  selected={
                    option === "off"
                      ? sleepTimer.mode === "off"
                      : option === "end-of-episode"
                        ? sleepTimer.mode === "end-of-episode"
                        : sleepTimer.mode === "timer" && sleepTimer.minutes === option
                  }
                  onPress={() => {
                    if (option === "off") {
                      cancelSleepTimer();
                    } else {
                      startSleepTimer(option);
                    }
                    setSleepPickerVisible(false);
                  }}
                />
              ))}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <BookmarkSheet
        visible={bookmarkSheetVisible}
        onDismiss={() => setBookmarkSheetVisible(false)}
        onSave={handleBookmarkSave}
      />
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  collapseButton: {
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: "center",
  },
  artwork: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: Spacing.three,
  },
  scrubberSection: {
    width: "100%",
    gap: Spacing.one,
  },
  track: {
    height: 8,
    justifyContent: "center",
  },
  trackBackground: {
    height: 4,
    borderRadius: 2,
  },
  trackFill: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: Spacing.two,
  },
  controlIcon: {
    textAlign: "center",
  },
  chipRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  sleepPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
});

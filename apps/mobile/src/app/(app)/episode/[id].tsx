import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { Skeleton } from "@/components/ui/skeleton";
import { resolveEpisodeForDeepLink } from "@/lib/resolve-episode-for-deep-link";
import { usePlayerStore } from "@/stores/player-store";

export default function EpisodeDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const expand = usePlayerStore((state) => state.expand);

  useEffect(() => {
    let cancelled = false;
    resolveEpisodeForDeepLink(id)
      .then((episode) => {
        if (cancelled) {
          return;
        }
        if (episode) {
          void playQueue([episode], 0).then(expand);
          router.replace(`/series/${episode.seriesId}`);
        } else {
          router.replace("/");
        }
      })
      .catch(() => {
        if (!cancelled) {
          router.replace("/");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Skeleton width="100%" height={200} />
    </SafeAreaView>
  );
}

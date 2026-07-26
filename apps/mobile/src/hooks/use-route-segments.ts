import { useSegments } from "expo-router";

/**
 * `useSegments()`, minus expo-router's typed-routes tuple-union return
 * type. That union types each possible route as its own fixed-length
 * tuple, which makes indexing/checking membership past the shortest
 * possible route's length a compile error even though every real value is
 * just an array of path-segment strings at runtime.
 */
export function useRouteSegments(): readonly string[] {
  return useSegments();
}

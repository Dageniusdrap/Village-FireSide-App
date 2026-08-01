# Maps Setup

Village Fireside's Explore tab uses `react-native-maps` (via
`react-native-map-clustering` for pin clustering).

## iOS

No setup needed — iOS uses Apple's native MapKit provider by default,
which requires no API key or account.

## Android

Android requires a real Google Maps API key before release. The
`app.json` `plugins` entry for `react-native-maps` currently holds a
placeholder string (`"your-android-google-maps-api-key"`) — replace it
directly in that file once a real key exists:

1. Create (or reuse) a project in the
   [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the "Maps SDK for Android" API for that project.
3. Create an API key under "Credentials," and restrict it to the Maps
   SDK for Android and this app's Android package name/SHA-1
   certificate fingerprint (do not ship an unrestricted key).
4. Replace `"your-android-google-maps-api-key"` in `apps/mobile/app.json`'s
   `react-native-maps` plugin config with the real key.
5. Run `npx expo prebuild --clean` (or rebuild via EAS) so the key gets
   baked into `AndroidManifest.xml`.

Until a real key is set, the Android map still renders but shows a
"for development purposes only" watermark — expected, not a bug, for
any build using the placeholder.

## Why iOS and Android differ

`react-native-maps`' Expo config plugin only sets `GMSApiKey` on iOS
(forcing Google Maps there) when an `iosGoogleMapsApiKey` is explicitly
provided. This app deliberately omits it, so iOS always uses Apple's
built-in provider — one less credential to manage, and no
development-mode watermark on iOS regardless of the Android key's state.

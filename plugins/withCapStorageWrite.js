// Expo config plugin: caps WRITE_EXTERNAL_STORAGE at android:maxSdkVersion=28.
//
// Why: from API 29 (Android 10) Android enforces scoped storage and
// WRITE_EXTERNAL_STORAGE is effectively a no-op there. Leaving the
// permission uncapped is a stale request — Play Console reviewers
// occasionally cite it as evidence that the app is asking for broader
// access than it needs. Capping the permission to API 28 keeps it for
// the small set of Android 9 (and older) devices where it's still
// meaningful, and drops it entirely on every newer device.
//
// Some Expo / RN libraries (expo-image-picker, expo-document-picker,
// react-native-image-crop-picker) auto-merge this permission into the
// manifest from their own library manifests. The plugin patches the
// merged result so the cap is present regardless of which library
// brought it in.

const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSION = 'android.permission.WRITE_EXTERNAL_STORAGE';
const MAX_SDK = '28';

const withCapStorageWrite = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const list = manifest['uses-permission'];
    const existing = list.find((p) => p?.$?.['android:name'] === PERMISSION);
    // tools:replace tells the manifest merger to use OUR maxSdkVersion
    // (28) when a library manifest declares the same permission with a
    // different cap. react-native-image-crop-picker's manifest sets it
    // to 29; without tools:replace the merger fails the build.
    if (existing) {
      existing.$['android:maxSdkVersion'] = MAX_SDK;
      existing.$['tools:replace'] = 'android:maxSdkVersion';
    } else {
      list.push({
        $: {
          'android:name': PERMISSION,
          'android:maxSdkVersion': MAX_SDK,
          'tools:replace': 'android:maxSdkVersion',
        },
      });
    }
    return cfg;
  });

module.exports = withCapStorageWrite;

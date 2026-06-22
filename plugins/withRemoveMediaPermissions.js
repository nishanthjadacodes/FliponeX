// Expo config plugin: strips READ_MEDIA_IMAGES + READ_MEDIA_VIDEO from
// the merged Android manifest. Google Play's Photo and Video Permissions
// policy (enforced June 2024+) blocks apps from declaring these
// permissions unless persistent broad photo-library access is a core use
// case. FliponeX only needs occasional photos for booking document
// uploads + avatar — exactly the "infrequent access" scenario the
// policy says must use the system Photo Picker instead.
//
// expo-image-picker + react-native-image-crop-picker both auto-merge
// these permissions into the manifest via their library manifests. This
// plugin overrides them with tools:node="remove" so the manifest merger
// drops them at build time. The runtime code separately stops calling
// requestMediaLibraryPermissionsAsync — on Android 13+ the system Photo
// Picker is used automatically and requires no permission at all.
//
// READ_MEDIA_VISUAL_USER_SELECTED is intentionally NOT removed — that's
// the Android 14+ partial-photo-access permission, which is exactly
// what the Photo Picker model wants.

const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS_TO_REMOVE = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
];

const withRemoveMediaPermissions = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const list = manifest['uses-permission'];

    for (const perm of PERMISSIONS_TO_REMOVE) {
      const existing = list.find((p) => p?.$?.['android:name'] === perm);
      if (existing) {
        existing.$['tools:node'] = 'remove';
      } else {
        list.push({
          $: {
            'android:name': perm,
            'tools:node': 'remove',
          },
        });
      }
    }
    return cfg;
  });

module.exports = withRemoveMediaPermissions;

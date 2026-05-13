// Expo config plugin: stops the UCrop activity (used by
// react-native-image-crop-picker) from drawing under the system status
// bar, so its toolbar tick / X icons + "Crop document" title don't
// merge with the phone's clock + signal + battery row.
//
// Strategy:
//   1. Define a new style `Theme.FliponeX.UCrop` in res/values/styles.xml
//      that inherits the AppCompat NoActionBar theme used by UCrop, but
//      adds explicit non-translucent status bar + fitsSystemWindows.
//   2. Use a manifest merger `tools:replace="android:theme"` on the
//      <activity android:name="com.yalantis.ucrop.UCropActivity"/>
//      declaration the library ships, swapping its theme to ours.
//
// This way the rest of the app keeps `edgeToEdgeEnabled: true`; only
// the cropper screen gets a proper status bar inset.

const {
  withAndroidStyles,
  withAndroidManifest,
} = require('@expo/config-plugins');

const STYLE_NAME = 'Theme.FliponeX.UCrop';
const UCROP_ACTIVITY = 'com.yalantis.ucrop.UCropActivity';

function buildItem(name, value) {
  return { $: { name }, _: value };
}

const withUCropStyle = (config) =>
  withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults;
    styles.resources = styles.resources || {};
    const list = styles.resources.style || [];
    const filtered = list.filter((s) => s?.$?.name !== STYLE_NAME);
    filtered.push({
      $: {
        name: STYLE_NAME,
        parent: 'Theme.AppCompat.Light.NoActionBar',
      },
      item: [
        buildItem('android:windowTranslucentStatus', 'false'),
        buildItem('android:fitsSystemWindows', 'true'),
        buildItem('android:statusBarColor', '#F9A825'),
        buildItem('android:windowLightStatusBar', 'true'),
      ],
    });
    styles.resources.style = filtered;
    return cfg;
  });

const withUCropActivityThemeReplace = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const app = manifest.application?.[0];
    if (!app) return cfg;
    app.activity = (app.activity || []).filter(
      (a) => a?.$?.['android:name'] !== UCROP_ACTIVITY,
    );
    app.activity.push({
      $: {
        'android:name': UCROP_ACTIVITY,
        'android:theme': `@style/${STYLE_NAME}`,
        'tools:replace': 'android:theme',
      },
    });
    return cfg;
  });

const withUCropStatusBar = (config) => {
  config = withUCropStyle(config);
  config = withUCropActivityThemeReplace(config);
  return config;
};

module.exports = withUCropStatusBar;

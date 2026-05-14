// Expo config plugin: pushes ONLY the UCrop activity (used by
// react-native-image-crop-picker) below the phone's status bar, so
// its toolbar tick / X / "Crop document" title don't merge with
// the system clock + signal + battery icons. The rest of the app
// keeps `edgeToEdgeEnabled: true` so the home screen and other
// screens still render edge-to-edge as designed.
//
// We use three layers — each one redundantly does the same thing,
// so even if Android ignores one (e.g. theme attributes don't
// propagate through UCrop's library layout), another catches it:
//
//   Layer A — define a `Theme.FliponeX.UCrop` style with explicit
//             non-translucent status bar + fitsSystemWindows
//   Layer B — manifest merger `tools:replace="android:theme"` on
//             the UCropActivity declaration shipped by the library
//   Layer C — runtime ActivityLifecycleCallbacks in MainApplication
//             that programmatically calls
//             WindowCompat.setDecorFitsSystemWindows(window, true)
//             when UCropActivity is created. This is the
//             belt-and-braces fix because UCrop's root layout
//             (inside the AAR) doesn't declare fitsSystemWindows,
//             so theme-only overrides can fail. Calling
//             setDecorFitsSystemWindows at runtime forces the
//             window to inset around system bars regardless of
//             what the layout says.

const {
  withAndroidStyles,
  withAndroidManifest,
  withMainApplication,
} = require('@expo/config-plugins');

const STYLE_NAME = 'Theme.FliponeX.UCrop';
const UCROP_ACTIVITY = 'com.yalantis.ucrop.UCropActivity';
const STATUS_BAR_COLOR = '#F9A825'; // gold strip behind clock/battery

function buildItem(name, value) {
  return { $: { name }, _: value };
}

// ─── Layer A: style override ──────────────────────────────────────
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
        buildItem('android:windowDrawsSystemBarBackgrounds', 'true'),
        buildItem('android:fitsSystemWindows', 'true'),
        buildItem('android:statusBarColor', STATUS_BAR_COLOR),
        buildItem('android:windowLightStatusBar', 'true'),
      ],
    });
    styles.resources.style = filtered;
    return cfg;
  });

// ─── Layer B: manifest merger override ────────────────────────────
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

// ─── Layer C: runtime inset fix via MainApplication ───────────────
//
// Block we inject inside MainApplication.onCreate(). It registers a
// lifecycle listener that detects when UCropActivity is created and
// flips off edge-to-edge for THAT window only. setDecorFitsSystemWindows(true)
// is the modern programmatic equivalent of theme-level
// windowTranslucentStatus=false + fitsSystemWindows=true, and unlike
// the theme it works regardless of what the activity's layout XML
// declares — which matters because UCrop's layout (inside the AAR)
// doesn't set fitsSystemWindows on its root view.
const UCROP_RUNTIME_INSET_BLOCK = `
    // BEGIN withUCropStatusBar: programmatic inset fix for UCropActivity
    try {
      registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {
          if (activity.javaClass.name == "com.yalantis.ucrop.UCropActivity") {
            try {
              androidx.core.view.WindowCompat.setDecorFitsSystemWindows(activity.window, true)
              activity.window.statusBarColor = android.graphics.Color.parseColor("${STATUS_BAR_COLOR}")
              androidx.core.view.WindowInsetsControllerCompat(activity.window, activity.window.decorView).isAppearanceLightStatusBars = true
            } catch (e: Throwable) {
              android.util.Log.w("UCropInsetFix", "apply failed: " + e.message)
            }
          }
        }
        override fun onActivityStarted(activity: android.app.Activity) {}
        override fun onActivityResumed(activity: android.app.Activity) {}
        override fun onActivityPaused(activity: android.app.Activity) {}
        override fun onActivityStopped(activity: android.app.Activity) {}
        override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}
        override fun onActivityDestroyed(activity: android.app.Activity) {}
      })
    } catch (e: Throwable) {
      android.util.Log.w("UCropInsetFix", "register failed: " + e.message)
    }
    // END withUCropStatusBar
`;

const withUCropRuntimeInset = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Don't double-inject if a prior prebuild already added the block.
    if (src.includes('BEGIN withUCropStatusBar')) {
      return cfg;
    }

    // Insert our block right after ApplicationLifecycleDispatcher.onApplicationCreate(this).
    // That call is the last line of the stock onCreate() body in
    // Expo's MainApplication template, so appending after it keeps
    // us at the end of onCreate() without disturbing anything else.
    const anchor = 'ApplicationLifecycleDispatcher.onApplicationCreate(this)';
    if (!src.includes(anchor)) {
      // Template changed — bail loudly rather than silently mis-injecting.
      console.warn(
        '[withUCropStatusBar] MainApplication.kt anchor missing; skipping runtime inset block',
      );
      return cfg;
    }
    src = src.replace(
      anchor,
      `${anchor}\n${UCROP_RUNTIME_INSET_BLOCK}`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });

const withUCropStatusBar = (config) => {
  config = withUCropStyle(config);
  config = withUCropActivityThemeReplace(config);
  config = withUCropRuntimeInset(config);
  return config;
};

module.exports = withUCropStatusBar;

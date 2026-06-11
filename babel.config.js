module.exports = function (api) {
  // Cache the resolved config per NODE_ENV so the production-only
  // console-strip plugin is correctly applied to release bundles and
  // skipped in dev (where logs are useful). A plain api.cache(true)
  // would freeze the config to whatever NODE_ENV was first seen.
  api.cache.using(() => process.env.NODE_ENV);

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.BABEL_ENV === 'production';

  const plugins = [];

  // Strip console.* from RELEASE bundles only. Each console call runs
  // on the JS thread and serializes its arguments — with 260+ calls
  // across the app that's measurable jank on low-end devices. We keep
  // console.error / console.warn so genuine problems still surface in
  // logcat / crash tooling.
  if (isProduction) {
    plugins.push(['transform-remove-console', { exclude: ['error', 'warn'] }]);
  }

  // react-native-worklets/plugin MUST be the LAST plugin in the array
  // (Reanimated v3+/v4 worklet requirement) — keep it appended last.
  plugins.push('react-native-worklets/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};

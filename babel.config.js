module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Required for react-native-reanimated v3+/v4 worklets.
      // Must be the LAST plugin in the array.
      'react-native-worklets/plugin',
    ],
  };
};

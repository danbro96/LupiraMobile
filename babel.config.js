module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Must be listed last per react-native-worklets-core docs.
      'react-native-worklets-core/plugin',
    ],
  };
};

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The Node export condition selects tslib's default-import wrapper during SSR.
// Use its direct ESM helpers on web; keep native resolution unchanged.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'tslib') {
    return { type: 'sourceFile', filePath: require.resolve('tslib/tslib.es6.mjs') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

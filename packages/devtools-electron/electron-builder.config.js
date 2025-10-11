// Custom electron-builder config with programmatic afterSign notarization
const path = require('path');

module.exports = {
  appId: 'org.cnstra.devtools',
  productName: 'CNStra DevTools',
  directories: {
    buildResources: 'build',
    output: 'dist',
  },
  files: [
    'main.js',
    'preload.js',
    'manager.html',
    'package.json',
    'resources/**/*',
  ],
  extraResources: [
    { from: 'resources/devtools-panel-ui-dist', to: 'devtools-panel-ui/dist' },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'entitlements.mac.plist',
    entitlementsInherit: 'entitlements.mac.plist',
    target: ['dmg', 'zip'],
    notarize: false, // disable built-in notarize; handled in afterSign
  },
  win: {
    target: ['nsis'],
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
  afterSign: async (context) => {
    if (context.electronPlatformName !== 'darwin') return;

    const { notarize } = require('@electron/notarize');

    const appBundleId = context.packager.appInfo.bundleId;
    const appOutDir = context.appOutDir;
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    const appleId = process.env.APPLE_ID;
    const applePassword = process.env.APPLE_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
    const teamId = process.env.TEAM_ID || process.env.APPLE_TEAM_ID;

    if (!appleId || !applePassword || !teamId) {
      console.warn('Skipping notarization: missing APPLE_ID/APPLE_PASSWORD(or APPLE_APP_SPECIFIC_PASSWORD)/TEAM_ID');
      return;
    }

    await notarize({
      tool: 'notarytool',
      appBundleId,
      appleId,
      appleIdPassword: applePassword,
      teamId,
      appPath,
    });
  },
};



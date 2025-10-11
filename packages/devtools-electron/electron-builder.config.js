// Custom electron-builder config with programmatic afterSign notarization
const path = require('path');
const entitlementsPath = path.join(__dirname, 'entitlements.mac.plist');

module.exports = {
  electronVersion: '30.0.0',
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
    { from: 'resources/img', to: 'img' },
    { from: 'resources/fonts', to: 'fonts' },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: entitlementsPath,
    entitlementsInherit: entitlementsPath,
    target: ['dmg', 'zip'],
    notarize: process.env.APPLE_TEAM_ID || process.env.TEAM_ID ? {
      teamId: process.env.APPLE_TEAM_ID || process.env.TEAM_ID,
    } : false,
  },
  win: {
    target: ['nsis'],
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
};



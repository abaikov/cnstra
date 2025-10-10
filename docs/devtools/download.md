---
id: download
title: Download DevTools
sidebar_label: Download
sidebar_position: 1
---

# Download CNStra DevTools

Desktop application for debugging and monitoring CNStra applications.

## Features

- **Server Manager**: Start/stop DevTools servers on custom ports
- **Live Monitoring**: Real-time view of stimulations, responses, and neural network topology
- **Multi-Instance**: Connect to multiple applications simultaneously
- **Cross-Platform**: Available for macOS, Windows, and Linux

## Installation

import BrowserOnly from '@docusaurus/BrowserOnly';

<BrowserOnly>
  {() => {
    const React = require('react');
    const [state, setState] = React.useState({ loading: true, url: '', error: '' });

    React.useEffect(() => {
      async function pick() {
        try {
          const platform = (window.navigator.platform || '').toLowerCase();
          const ua = (window.navigator.userAgent || '').toLowerCase();
          const isMac = platform.includes('mac') || ua.includes('mac');
          const isWindows = platform.includes('win') || ua.includes('win');
          const isLinux = (platform.includes('linux') || ua.includes('linux')) && !ua.includes('android');
          const isArm = ua.includes('arm') || ua.includes('aarch64') || ua.includes('apple');

          const res = await fetch('https://api.github.com/repos/abaikov/cnstra/releases/latest', { headers: { 'Accept': 'application/vnd.github+json' } });
          if (!res.ok) throw new Error('Failed to fetch latest release');
          const json = await res.json();
          const assets = json.assets || [];

          function findAsset(regex) {
            return assets.find(a => regex.test(a.name));
          }

          let asset;
          if (isMac) {
            // Prefer DMG; choose arch by UA
            asset = isArm
              ? findAsset(/DevTools-.*-arm64\.dmg$/)
              : findAsset(/DevTools-.*-x64\.dmg$/) || findAsset(/DevTools-.*-intel\.dmg$/);
          } else if (isWindows) {
            asset = findAsset(/Setup .*\.exe$/) || findAsset(/DevTools-.*\.exe$/);
          } else if (isLinux) {
            asset = findAsset(/DevTools-.*\.AppImage$/);
          }

          if (!asset) throw new Error('No matching asset for your platform');
          setState({ loading: false, url: asset.browser_download_url, error: '' });
        } catch (e) {
          setState({ loading: false, url: '', error: (e && e.message) || 'Unknown error' });
        }
      }
      pick();
    }, []);

    return (
      <div>
        {state.loading ? (
          <p>Detecting your platform and preparing the latest download…</p>
        ) : state.url ? (
          <div>
            <a className="button button--primary button--lg" href={state.url}>Download latest for your system</a>
            <p style={{ marginTop: 8 }}>
              Not your platform? <a href="https://github.com/abaikov/cnstra/releases/latest">See all downloads</a>
            </p>
          </div>
        ) : (
          <div>
            <p>Could not determine a suitable installer automatically.</p>
            <p><a href="https://github.com/abaikov/cnstra/releases/latest">Open latest releases page</a> and pick your platform manually.</p>
            {state.error && <pre>{state.error}</pre>}
          </div>
        )}
      </div>
    );
  }}
</BrowserOnly>

## Usage

1. Launch CNStra DevTools
2. Click "Start Server" to spawn a DevTools server (default port: 8080)
3. In your application, configure DevTools transport:

```typescript
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({
  url: 'ws://localhost:8080'
});
```

4. Click "Open Panel" in the manager to view your application's neural network

## All Releases

View all versions and release notes on [GitHub Releases](https://github.com/abaikov/cnstra/releases).


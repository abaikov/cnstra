---
sidebar_position: 7
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
    const platform = typeof window !== 'undefined' ? window.navigator.platform.toLowerCase() : '';
    const userAgent = typeof window !== 'undefined' ? window.navigator.userAgent.toLowerCase() : '';
    const isMac = platform.includes('mac') || userAgent.includes('mac');
    const isWindows = platform.includes('win') || userAgent.includes('win');
    const isLinux = (platform.includes('linux') || userAgent.includes('linux')) && !userAgent.includes('android');
    const isAppleSilicon = userAgent.includes('arm') || userAgent.includes('aarch64');

    return (
      <div>
        {isMac && (
          <div>
            <h3>macOS</h3>
            <p><strong>Recommended for your system:</strong></p>
            <ul>
              <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7-arm64.dmg">Download DMG (Apple Silicon)</a></li>
              <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7-arm64-mac.zip">Download ZIP (Apple Silicon)</a></li>
            </ul>
          </div>
        )}
        {isWindows && (
          <div>
            <h3>Windows</h3>
            <p><strong>Recommended for your system:</strong></p>
            <ul>
              <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools%20Setup%201.0.7.exe">Download Installer (.exe)</a></li>
            </ul>
          </div>
        )}
        {isLinux && (
          <div>
            <h3>Linux</h3>
            <p><strong>Recommended for your system:</strong></p>
            <ul>
              <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7.AppImage">Download AppImage</a></li>
            </ul>
            <p>Make the AppImage executable:</p>
            <pre><code>chmod +x CNStra\ DevTools-1.0.7.AppImage{'\n'}./CNStra\ DevTools-1.0.7.AppImage</code></pre>
          </div>
        )}
        {!isMac && !isWindows && !isLinux && (
          <div>
            <p>Choose your platform below:</p>
          </div>
        )}
        <details>
          <summary><strong>All Platforms</strong></summary>
          <h4>macOS</h4>
          <p><strong>Apple Silicon (M1/M2/M3)</strong></p>
          <ul>
            <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7-arm64.dmg">Download DMG</a></li>
            <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7-arm64-mac.zip">Download ZIP</a></li>
          </ul>
          <p><strong>Intel (x64)</strong></p>
          <ul>
            <li>Coming soon</li>
          </ul>
          <h4>Windows</h4>
          <ul>
            <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools%20Setup%201.0.7.exe">Download Installer (.exe)</a></li>
          </ul>
          <h4>Linux</h4>
          <ul>
            <li><a href="https://github.com/abaikov/cnstra/releases/latest/download/CNStra%20DevTools-1.0.7.AppImage">Download AppImage</a></li>
          </ul>
          <p>Make the AppImage executable:</p>
          <pre><code>chmod +x CNStra\ DevTools-1.0.7.AppImage{'\n'}./CNStra\ DevTools-1.0.7.AppImage</code></pre>
        </details>
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


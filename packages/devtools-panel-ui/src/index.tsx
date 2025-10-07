import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/theme.css';
import './ui/components.css';
import './ui/cns-graph.css';
import './ui/styles.css';

// Add DevTools to the panel UI itself for debugging and app switching testing
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';
import { mainCNS } from './cns';

// Initialize DevTools for the panel UI
const setupDevTools = () => {
    try {
        // const transport = new CNSDevToolsTransportWs({
        //     url:
        //         window.location.protocol === 'https:'
        //             ? `wss://${window.location.host}`
        //             : `ws://${window.location.host}`,
        //     webSocketImpl: WebSocket,
        // });
        // const devtools = new CNSDevTools('devtools-panel-ui', transport, {
        //     devToolsInstanceName: 'DevTools Panel UI (Self-Debug)',
        //     takeDataSnapshot: () => ({
        //         timestamp: Date.now(),
        //         location: window.location.href,
        //         userAgent: navigator.userAgent,
        //     }),
        // });
        // devtools.registerCNS(mainCNS);
        // console.log('🔧 DevTools Panel UI is now self-monitoring!');
        // console.log('   📡 Connected to:', transport);
        // console.log('   🎯 App ID: devtools-panel-ui');
        // console.log('   📊 You can now see this UI as an app in the DevTools');
    } catch (error) {
        console.warn('⚠️ Failed to initialize DevTools for panel UI:', error);
    }
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
    console.log('🔧 DevTools Panel UI is now rendering');

    // Setup DevTools immediately
    // setupDevTools();
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/theme.css';
import './ui/components.css';
import './ui/cns-graph.css';
import './ui/styles.css';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}

import { defineConfig } from 'vite';
import { CNS_PANEL_VITE_BASE_CONFIG } from './CNS_PANEL_VITE_BASE_CONFIG';

export default defineConfig({
    ...CNS_PANEL_VITE_BASE_CONFIG,
    base: './',
    server: {
        port: 5173,
        host: '0.0.0.0',
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});

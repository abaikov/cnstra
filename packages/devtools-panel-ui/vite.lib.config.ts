import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { CNS_PANEL_VITE_BASE_CONFIG } from './CNS_PANEL_VITE_BASE_CONFIG';

export default defineConfig({
    ...CNS_PANEL_VITE_BASE_CONFIG,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        outDir: 'dist/lib',
        emptyOutDir: true,
        copyPublicDir: false,
        minify: true,
        sourcemap: true,
        lib: {
            entry: fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
            formats: ['es'],
            fileName: () => 'cnstra-devtools-panel.mjs',
            cssFileName: 'cnstra-devtools-panel',
        },
        rollupOptions: {
            external: id => /^@(oimdb|exodra|cnstra)\//.test(id),
        },
    },
});

import { defineConfig, type Plugin } from 'vite';
import { transform } from '@swc/core';
import { createRequire } from 'node:module';

// Exodra JSX transform via the official SWC compiler (`swc-plugin-exodra`, a
// Rust/Wasm port of @exodra/babel-plugin-jsx) — faster than Babel. Every
// .tsx/.jsx compiles to h()/text() calls with the static/bindables/bindableLists
// buckets. `enforce: 'pre'` so it owns the JSX pipeline before esbuild. The wasm
// plugin is passed by absolute path (SWC's name-based resolution needs a
// node_modules base it doesn't have here) and its swc_core ABI must match
// @swc/core (both 1.15.x).
const require = createRequire(import.meta.url);
const exodraWasm = require.resolve('swc-plugin-exodra/swc_plugin_exodra.wasm');

function jsxPlugin(): Plugin {
    return {
        name: 'cnstra-panel-jsx-swc',
        enforce: 'pre',
        async transform(code, id) {
            if (!/\.[jt]sx$/.test(id) || id.includes('node_modules')) return;
            const result = await transform(code, {
                filename: id,
                sourceMaps: true,
                jsc: {
                    parser: { syntax: 'typescript', tsx: true },
                    target: 'es2020',
                    experimental: { plugins: [[exodraWasm, {}]] },
                },
            });
            return { code: result.code, map: result.map ?? undefined };
        },
    };
}

export default defineConfig({
    plugins: [jsxPlugin()],
    server: {
        port: 5173,
        host: '0.0.0.0',
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});

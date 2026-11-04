import type { Plugin, UserConfig } from 'vite';
import { transform } from '@swc/core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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

const nodeBuiltinStub = fileURLToPath(new URL('./src/transport/demo/nodeBuiltinStub.ts', import.meta.url));

export const CNS_PANEL_VITE_BASE_CONFIG: UserConfig = {
    plugins: [jsxPlugin()],
    resolve: {
        dedupe: ['@exodra/core', '@exodra/dom', '@exodra/context', '@exodra/list-reconcile', '@oimdb/core', '@oimdb/exodra', '@oimdb/browser', '@cnstra/core'],
        alias: [{ find: /^(node:)?(child_process|crypto|fs|fs\/promises|http|module|path|ws)$/, replacement: nodeBuiltinStub }],
    },
};

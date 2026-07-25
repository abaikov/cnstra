import { defineConfig, type Plugin } from 'vite';
import * as babel from '@babel/core';
import exodraJsx from '@exodra/babel-plugin-jsx';

// Dual-JSX transform. Two JSX dialects coexist during the incremental migration:
//   - Exodra JSX (default) — every .tsx/.jsx compiles to h() calls with the
//     static/bindables/bindableLists buckets via @exodra/babel-plugin-jsx.
//   - React JSX — files under src/react-islands/** are heavy components kept as
//     React islands (mounted via @exodra/react `reactIsland`). They compile with
//     the React automatic runtime instead.
// The plugin runs `enforce: 'pre'` so it owns the JSX pipeline before esbuild.
function jsxPlugin(): Plugin {
    // A file is compiled as React (not Exodra) when it opts in with a
    //   /** @jsxImportSource react */
    // pragma, or lives under src/react-islands/. This lets existing React
    // components stay in place and keep importing each other during the
    // incremental migration — each file is converted to Exodra by dropping the
    // pragma and rewriting its JSX. Dialect is decided per file, by the file's
    // own opt-in, never by who imports it.
    const isReact = (code: string, id: string): boolean =>
        code.includes('@jsxImportSource react') ||
        id.includes('/src/react-islands/') ||
        id.includes('\\src\\react-islands\\');

    return {
        name: 'cnstra-panel-jsx',
        enforce: 'pre',
        transform(code, id) {
            if (!/\.[jt]sx$/.test(id) || id.includes('node_modules')) return;
            const react = isReact(code, id);
            const result = babel.transformSync(code, {
                filename: id,
                sourceMaps: true,
                babelrc: false,
                configFile: false,
                presets: [
                    ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
                    ...(react
                        ? [['@babel/preset-react', { runtime: 'automatic' }] as const]
                        : []),
                ],
                plugins: react ? [] : [['@babel/plugin-syntax-jsx'], exodraJsx],
            });
            if (!result?.code) return undefined;
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

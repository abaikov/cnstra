import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.tsx'],
    format: ['cjs', 'esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
});

import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: false,
    noExternal: ['@cnstra/postgres-schema'],
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
});

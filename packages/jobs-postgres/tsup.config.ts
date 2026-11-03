import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    noExternal: ['@cnstra/postgres-schema'],
    clean: true,
    sourcemap: true,
});

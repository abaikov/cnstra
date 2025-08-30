import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: false, // Disable type generation for now
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    noExternal: [],
});

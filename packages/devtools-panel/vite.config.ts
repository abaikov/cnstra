import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    build: {
        lib: {
            entry: 'src/index.ts',
            name: 'CNSDevToolsPanel',
            formats: ['es', 'umd'],
        },
        rollupOptions: {
            external: ['react', 'react-dom', 'pixi.js', 'elkjs'],
            output: {
                globals: {
                    react: 'React',
                    'react-dom': 'ReactDOM',
                    'pixi.js': 'PIXI',
                    elkjs: 'ELK',
                },
            },
        },
    },
});

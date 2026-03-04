import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    base: '/__mockcraft__/',
    build: {
        outDir: path.resolve(__dirname, '..', 'ui-dist'),
        emptyOutDir: true,
    },
    server: {
        proxy: {
            '/__mockcraft__/api': 'http://localhost:3000',
            '/__mockcraft__/ws': {
                target: 'ws://localhost:3000',
                ws: true,
            },
        },
    },
});

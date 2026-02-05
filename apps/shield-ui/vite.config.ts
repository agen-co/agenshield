/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/shield-ui',
  resolve: {
    alias: {
      '@agenshield/ipc': resolve(__dirname, '../../libs/shield-ipc/src/index.ts'),
    },
  },
  server: {
    port: 4200,
    host: 'localhost',
    fs: {
      allow: ['../..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
      '/sse': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  build: {
    outDir: '../../dist/apps/shield-ui',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});

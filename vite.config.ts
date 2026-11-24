import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
import { createApiMiddleware } from './server/api';
import { stopComputerDriver } from './server/computerUse';

function agentHqApiPlugin(): Plugin {
  const middleware = createApiMiddleware();
  return {
    name: 'agent-hq-api',
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once('close', stopComputerDriver);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      server.httpServer.once('close', stopComputerDriver);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), agentHqApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version),
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        tray: path.resolve(__dirname, 'tray.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: { ignored: ['**/test-results/**', '**/dist/**'] },
  },
  preview: {
    port: 5173,
    host: '127.0.0.1',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
} as Parameters<typeof defineConfig>[0]);

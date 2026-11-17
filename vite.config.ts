import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { createApiMiddleware } from './server/api';

function agentHqApiPlugin(): Plugin {
  const middleware = createApiMiddleware();
  return {
    name: 'agent-hq-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), agentHqApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: { ignored: ['**/test-results/**', '**/dist/**'] },
  },
  preview: {
    port: 5173,
    host: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
} as Parameters<typeof defineConfig>[0]);

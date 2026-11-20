import { defineConfig } from '@playwright/test';
import fs from 'fs';
import { E2E_CONFIG_DIR, E2E_PORT, E2E_WORKSPACE, resetFixtureWorkspace } from './tests/e2e/fixture';

resetFixtureWorkspace();
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const LOCAL_CHROME = '/home/mahmoud/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const CHROME_EXECUTABLE = process.env.PLAYWRIGHT_CHROME_PATH || (fs.existsSync(LOCAL_CHROME) ? LOCAL_CHROME : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: CHROME_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite ${process.env.AGENT_HQ_E2E_BUILT ? 'preview' : ''} --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: false,
    env: { AGENT_HQ_WORKSPACE: E2E_WORKSPACE, AGENT_HQ_CONFIG_DIR: E2E_CONFIG_DIR },
    timeout: 30_000,
  },
});

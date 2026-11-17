import { defineConfig } from '@playwright/test';

const CHROME_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROME_PATH ||
  '/home/mahmoud/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

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
    baseURL: process.env.AGENT_HQ_URL || 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: CHROME_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

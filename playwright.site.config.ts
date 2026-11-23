import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const localChrome = '/home/mahmoud/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

export default defineConfig({
  testDir: './tests/site',
  timeout: 30_000,
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  outputDir: 'test-results-site',
  use: {
    baseURL: 'http://127.0.0.1:4180',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/preview-site.mjs',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});

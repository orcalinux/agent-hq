import { defineConfig } from '@playwright/test';
import path from 'path';
import base from './playwright.config';
import { SCALE } from './tests/demo/recorder';

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;
const launch = base.use?.launchOptions ?? {};

/**
 * Recordings run every terminal through tests/demo/shell/bash, so no personal prompt, startup output or history appears.
 * Chromium's screencast sends frames at CSS-pixel size whatever `deviceScaleFactor` says, so the browser itself is
 * started at the recording scale: frames then arrive at full resolution (2880×1620) instead of being upscaled later.
 */
export default defineConfig({
  ...base,
  testDir: './tests/demo',
  timeout: 240_000,
  use: { ...base.use, launchOptions: { ...launch, args: [...(launch.args ?? []), `--force-device-scale-factor=${SCALE}`] } },
  webServer: { ...server, env: { ...server.env, SHELL: path.resolve('tests/demo/shell/bash') } },
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const executablePath = process.env.AGENT_HQ_PACKAGED_EXECUTABLE || path.join(root, 'release/linux-unpacked/agent-hq');
const appImage = process.env.APPIMAGE || path.join(root, `release/Agent-HQ-${version}-linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`);
if (!fs.existsSync(executablePath)) throw new Error('Build an installer first, or set AGENT_HQ_PACKAGED_EXECUTABLE to its packaged executable.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-packaged-update-'));
const userData = path.join(temporary, 'user-data');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'update-prefs.json'), JSON.stringify({ auto: false, autoDownload: false, autoRestart: false }));
const instance = await electron.launch({
  executablePath,
  args: process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [],
  env: {
    ...process.env,
    ...(process.platform === 'linux' ? { APPIMAGE: appImage } : {}),
    AGENT_HQ_USER_DATA: userData,
    AGENT_HQ_CONFIG_DIR: path.join(temporary, 'config'),
    AGENT_HQ_WORKSPACE: temporary,
    AGENT_HQ_NO_UPDATES: '',
    AGENT_HQ_SIMULATE_UPDATE: '',
    MAGPIE_GATEWAY: '127.0.0.1:9',
    OLLAMA_HOST: '127.0.0.1:9',
  },
});
try {
  if (!await instance.evaluate(({ app }) => app.isPackaged)) throw new Error('This check requires a packaged build.');
  const page = await instance.firstWindow();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.agentHqDesktop.getUpdateState())).status, { timeout: 45_000 }).toMatch(/^(up-to-date|available|error)$/);
  const state = await page.evaluate(() => window.agentHqDesktop.getUpdateState());
  await page.screenshot({ path: path.join(temporary, 'update-check.png') });
  console.log(JSON.stringify({ packaged: true, state, artifacts: temporary }));
  if (!['up-to-date', 'available'].includes(state.status) || state.simulated) throw new Error(`Real update check failed: ${state.error ?? state.status}`);
  const prefs = await page.evaluate(() => window.agentHqDesktop.getUpdatePrefs());
  if (prefs.auto || prefs.autoDownload || prefs.autoRestart) throw new Error('Manual checking changed automatic update preferences.');
} finally {
  await instance.close();
}

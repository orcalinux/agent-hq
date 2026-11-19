// Renders the app, installer and tray icons from public/logo.svg.
// Run after changing the logo: node scripts/render-icons.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8');

// The monogram alone, in black, for the macOS menu bar (a template image).
const template = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <path d="M30 100L64 28L98 100" stroke="#000" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M44 78H84" stroke="#000" stroke-width="11" stroke-linecap="round"/>
  <circle cx="64" cy="26" r="13" fill="#000"/>
</svg>`;

const jobs = [
  { svg: logo, size: 1024, out: 'build/icon.png' },
  { svg: logo, size: 1024, pad: 0.1, out: 'build/icon-mac.png' },
  ...[16, 24, 32, 48, 64, 128, 256, 512].map((size) => ({ svg: logo, size, out: `build/icons/${size}x${size}.png` })),
  { svg: logo, size: 512, out: 'electron/assets/icon.png' },
  { svg: logo, size: 32, out: 'electron/assets/tray.png' },
  { svg: logo, size: 64, out: 'electron/assets/tray@2x.png' },
  { svg: template, size: 22, out: 'electron/assets/trayTemplate.png' },
  { svg: template, size: 44, out: 'electron/assets/trayTemplate@2x.png' },
];

const executablePath = process.env.AGENT_HQ_CHROME && fs.existsSync(process.env.AGENT_HQ_CHROME) ? process.env.AGENT_HQ_CHROME : undefined;
const browser = await chromium.launch({ executablePath });
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.size, height: job.size } });
  const inset = Math.round(job.size * (job.pad ?? 0));
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="box-sizing:border-box;width:${job.size}px;height:${job.size}px;padding:${inset}px">` +
      job.svg.replace('<svg ', '<svg width="100%" height="100%" ') +
      '</div></body></html>'
  );
  const file = path.join(root, job.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log(`${job.out} ${job.size}px`);
}
await browser.close();

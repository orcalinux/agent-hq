import fs from 'fs';
import os from 'os';
import path from 'path';

/** Throwaway project the e2e server opens, so tests never touch a real project or config. */
export const E2E_WORKSPACE = path.join(os.tmpdir(), 'agent-hq-e2e', 'demo-app');
export const E2E_CONFIG_DIR = path.join(os.tmpdir(), 'agent-hq-e2e-config');
export const E2E_PORT = Number(process.env.AGENT_HQ_E2E_PORT || 5180);

export const FIXTURE_FILES: Record<string, string> = {
  'README.md': '# Fixture project\n\nREADME-MARKER: used by the e2e suite.\n',
  'src/greeting.ts': "export const greeting = 'GREETING-MARKER';\n",
  'src/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
};

/** Recreates the fixture project with exactly the fixture files. */
export function resetFixtureWorkspace(): void {
  fs.rmSync(E2E_WORKSPACE, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const full = path.join(E2E_WORKSPACE, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(E2E_CONFIG_DIR, { recursive: true });
}

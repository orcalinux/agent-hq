import fs from 'node:fs';
import { detectCli } from './providers';
import type { AgentCliUpdate, AgentCliUpdates } from '../src/types/agentUpdates';

const AGENTS = [
  { id: 'claude', name: 'Claude Code', package: '@anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex CLI', package: '@openai/codex' },
  { id: 'gemini', name: 'Gemini CLI', package: '@google/gemini-cli' },
] as const;

export function cliVersion(text: string | undefined): string | undefined {
  return text?.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1];
}

export function stableUpdateAvailable(current: string | undefined, latest: string): boolean {
  const installed = cliVersion(current);
  if (!installed || !/^\d+\.\d+\.\d+$/.test(latest)) return false;
  const before = installed.split('-')[0].split('.').map(Number);
  const after = latest.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (after[index] !== before[index]) return after[index] > before[index];
  }
  return installed.includes('-');
}

export function cliUpdateMethod(id: AgentCliUpdate['id'], binaryPath: string | undefined): Pick<AgentCliUpdate, 'command' | 'method'> {
  const agent = AGENTS.find((entry) => entry.id === id)!;
  if (!binaryPath) return { command: `npm install -g ${agent.package}@latest`, method: 'Install with npm' };
  let resolved = binaryPath;
  try { resolved = fs.realpathSync(binaryPath); } catch {}
  const normalized = resolved.replace(/\\/g, '/');
  if (/\/(Cellar|Caskroom)\//.test(normalized)) {
    return { command: `brew upgrade ${id === 'claude' ? '--cask claude-code' : id === 'codex' ? '--cask codex' : 'gemini-cli'}`, method: 'Homebrew' };
  }
  if (normalized.includes(`/node_modules/${agent.package}/`)) {
    return { command: `npm install -g ${agent.package}@latest`, method: 'npm' };
  }
  if (id === 'claude' && /\/(\.local\/share\/claude|\.claude\/local)\//.test(normalized)) {
    return { command: 'claude update', method: 'Claude native installer' };
  }
  return { command: null, method: 'Managed installation: update using its original installer or host application' };
}

export async function checkAgentUpdates(): Promise<AgentCliUpdates> {
  const agents = await Promise.all(AGENTS.map(async (agent): Promise<AgentCliUpdate> => {
    const detected = await detectCli(agent.id);
    const base = {
      id: agent.id, name: agent.name, installed: detected.detected,
      current: cliVersion(detected.version), available: false,
      ...cliUpdateMethod(agent.id, detected.path),
    };
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(agent.package)}/latest`, {
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
      const payload = await response.json() as { version?: unknown };
      if (typeof payload.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(payload.version)) {
        throw new Error('Registry did not return a stable version.');
      }
      return { ...base, latest: payload.version, available: stableUpdateAvailable(base.current, payload.version) };
    } catch (cause) {
      return { ...base, error: (cause as Error).message };
    }
  }));
  return { checkedAt: Date.now(), agents };
}

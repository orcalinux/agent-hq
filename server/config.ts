import fs from 'fs';
import os from 'os';
import path from 'path';

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama' | 'magpie';
export type ConnectionMethod = 'api_key' | 'env_key' | 'cli' | 'local_endpoint';

export interface StoredConnection {
  providerId: ProviderId;
  method: ConnectionMethod;
  apiKey?: string;
  endpointUrl?: string;
  cliBinary?: string;
  connectedAt: string;
  lastVerifiedAt?: string;
  lastError?: string;
  cliModelObservation?: { cwd: string; models: Record<string, string[]> };
}

export interface StoredConfig {
  workspaceRoot?: string;
  recentWorkspaces?: string[];
  connections: Partial<Record<ProviderId, StoredConnection>>;
}

export const REPO_ROOT = path.resolve(__dirname, '..');

export function configDir(): string {
  return process.env.AGENT_HQ_CONFIG_DIR || path.join(os.homedir(), '.config', 'agent-hq');
}

function configFile(): string {
  return path.join(configDir(), 'config.json');
}

let cache: StoredConfig | null = null;

export function loadConfig(): StoredConfig {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw) as StoredConfig;
    cache = { ...parsed, connections: parsed.connections ?? {} };
  } catch {
    cache = { connections: {} };
  }
  return cache;
}

export function saveConfig(next: StoredConfig): void {
  cache = next;
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = configFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function updateConfig(mutator: (cfg: StoredConfig) => void): StoredConfig {
  const current = loadConfig();
  const copy: StoredConfig = JSON.parse(JSON.stringify(current));
  mutator(copy);
  saveConfig(copy);
  return copy;
}

export function getWorkspaceRoot(): string {
  const fromEnv = process.env.AGENT_HQ_WORKSPACE;
  if (fromEnv) return path.resolve(fromEnv);
  const stored = loadConfig().workspaceRoot;
  if (stored && fs.existsSync(stored) && fs.statSync(stored).isDirectory()) return stored;
  const fallback = process.env.AGENT_HQ_FALLBACK_WORKSPACE;
  if (fallback) {
    fs.mkdirSync(fallback, { recursive: true });
    return path.resolve(fallback);
  }
  return REPO_ROOT;
}

export function maskSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

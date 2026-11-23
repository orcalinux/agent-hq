import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

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
  /** Embedding model for project memory search: "auto" (default), "off", or an Ollama model name. */
  memory?: { embeddingModel?: string };
}

export const REPO_ROOT = path.resolve(__dirname, '..');

export function configDir(): string {
  return process.env.AGENT_HQ_CONFIG_DIR || path.join(os.homedir(), '.config', 'agent-hq');
}

function configFile(): string {
  return path.join(configDir(), 'config.json');
}

let cache: StoredConfig | null = null;

const ENCRYPTED_PREFIX = 'enc:v1:';
const SEALED_PREFIX = 'keychain:v1:';

/** Seals the encryption key with the operating system's credential store (Electron safeStorage). */
export interface SecretProtector {
  seal(plain: Buffer): Buffer;
  unseal(sealed: Buffer): Buffer;
}

let protector: SecretProtector | null = null;
let keyCache: Buffer | null = null;

export function setSecretProtector(next: SecretProtector | null): void {
  protector = next;
  keyCache = null;
}

export function secretProtection(): 'keychain' | 'file' {
  return protector ? 'keychain' : 'file';
}

function secretKey(): Buffer {
  if (keyCache) return keyCache;
  const file = path.join(configDir(), 'secret.key');
  const write = (key: Buffer) => {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    const body = protector ? `${SEALED_PREFIX}${protector.seal(key).toString('base64')}` : key.toString('hex');
    fs.writeFileSync(file, body, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  };
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text.startsWith(SEALED_PREFIX)) {
      if (!protector) throw new Error('The key is sealed by the system keychain, which is not available.');
      const key = protector.unseal(Buffer.from(text.slice(SEALED_PREFIX.length), 'base64'));
      if (key.length === 32) return (keyCache = key);
    } else {
      const existing = Buffer.from(text, 'hex');
      if (existing.length === 32) {
        if (protector) write(existing);
        return (keyCache = existing);
      }
    }
  } catch {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').startsWith(SEALED_PREFIX)) throw new Error('Cannot unseal the stored key.');
  }
  const created = crypto.randomBytes(32);
  write(created);
  return (keyCache = created);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decryptSecret(stored: string): string | undefined {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

function mapKeys(config: StoredConfig, convert: (value: string) => string | undefined): StoredConfig {
  const copy: StoredConfig = JSON.parse(JSON.stringify(config));
  for (const connection of Object.values(copy.connections)) {
    if (connection?.apiKey) {
      const converted = convert(connection.apiKey);
      if (converted === undefined) delete connection.apiKey;
      else connection.apiKey = converted;
    }
  }
  return copy;
}

export function loadConfig(): StoredConfig {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw) as StoredConfig;
    cache = mapKeys({ ...parsed, connections: parsed.connections ?? {} }, decryptSecret);
  } catch {
    cache = { connections: {} };
  }
  return cache;
}

export function saveConfig(next: StoredConfig): void {
  const keyFile = path.join(configDir(), 'secret.key');
  if (!protector && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8').startsWith(SEALED_PREFIX)) {
    throw new Error('Saved API keys are sealed by the system keychain, which is not available right now. Nothing was changed.');
  }
  cache = next;
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const file = configFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(mapKeys(next, encryptSecret), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function resetConfigCache(): void {
  cache = null;
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

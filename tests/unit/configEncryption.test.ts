import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, loadConfig, resetConfigCache, saveConfig, secretProtection, setSecretProtector } from '../../server/config';

describe('API key encryption at rest', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-cfg-'));
    process.env.AGENT_HQ_CONFIG_DIR = dir;
    resetConfigCache();
  });
  afterEach(() => {
    delete process.env.AGENT_HQ_CONFIG_DIR;
    setSecretProtector(null);
    resetConfigCache();
  });

  it('round-trips a secret and never stores it in plain text', () => {
    const stored = encryptSecret('sk-test-1234567890');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('sk-test');
    expect(decryptSecret(stored)).toBe('sk-test-1234567890');
  });

  it('writes keys encrypted to disk and reads them back', () => {
    saveConfig({ connections: { openrouter: { providerId: 'openrouter', method: 'api_key', apiKey: 'sk-or-secret-value', connectedAt: 'now' } } });
    const onDisk = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    expect(onDisk).not.toContain('sk-or-secret-value');
    expect(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777).toBe(0o600);
    resetConfigCache();
    expect(loadConfig().connections.openrouter?.apiKey).toBe('sk-or-secret-value');
  });

  it('still reads a legacy plain-text config and upgrades it on the next save', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ connections: { openai: { providerId: 'openai', method: 'api_key', apiKey: 'sk-legacy-value', connectedAt: 'then' } } }));
    const loaded = loadConfig();
    expect(loaded.connections.openai?.apiKey).toBe('sk-legacy-value');
    saveConfig(loaded);
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).not.toContain('sk-legacy-value');
  });

  it('drops a key that cannot be decrypted instead of using garbage', () => {
    expect(decryptSecret('enc:v1:AAAA')).toBeUndefined();
  });

  const fakeKeychain = { seal: (plain: Buffer) => Buffer.from(plain.toString('hex').split('').reverse().join('')), unseal: (sealed: Buffer) => Buffer.from(sealed.toString().split('').reverse().join(''), 'hex') };

  it('seals the key with the system keychain when one is available', () => {
    setSecretProtector(fakeKeychain);
    expect(secretProtection()).toBe('keychain');
    saveConfig({ connections: { openai: { providerId: 'openai', method: 'api_key', apiKey: 'sk-sealed-value', connectedAt: 'now' } } });
    const keyFile = fs.readFileSync(path.join(dir, 'secret.key'), 'utf8');
    expect(keyFile.startsWith('keychain:v1:')).toBe(true);
    expect(keyFile).not.toMatch(/^[0-9a-f]{64}$/);
    setSecretProtector(fakeKeychain);
    resetConfigCache();
    expect(loadConfig().connections.openai?.apiKey).toBe('sk-sealed-value');
  });

  it('upgrades an existing plain key file to a sealed one without losing keys', () => {
    saveConfig({ connections: { openai: { providerId: 'openai', method: 'api_key', apiKey: 'sk-upgrade-value', connectedAt: 'now' } } });
    expect(/^[0-9a-f]{64}$/.test(fs.readFileSync(path.join(dir, 'secret.key'), 'utf8'))).toBe(true);
    setSecretProtector(fakeKeychain);
    resetConfigCache();
    expect(loadConfig().connections.openai?.apiKey).toBe('sk-upgrade-value');
    expect(fs.readFileSync(path.join(dir, 'secret.key'), 'utf8').startsWith('keychain:v1:')).toBe(true);
  });

  it('refuses to save, instead of dropping keys, when the key is sealed and the keychain is gone', () => {
    setSecretProtector(fakeKeychain);
    saveConfig({ connections: { openai: { providerId: 'openai', method: 'api_key', apiKey: 'sk-keep-me', connectedAt: 'now' } } });
    setSecretProtector(null);
    resetConfigCache();
    expect(loadConfig().connections.openai?.apiKey).toBeUndefined();
    expect(() => saveConfig({ connections: {} })).toThrow(/keychain/);
    setSecretProtector(fakeKeychain);
    resetConfigCache();
    expect(loadConfig().connections.openai?.apiKey).toBe('sk-keep-me');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStateStorage } from '../../electron/stateStorage';

describe('desktop state across local ports', () => {
  let directory: string;
  let storage: ReturnType<typeof createStateStorage>;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-state-'));
    storage = createStateStorage(directory);
  });
  afterEach(() => {
    storage.flush();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('restores the latest value on a different origin, including returning to an older origin', () => {
    storage.write('agent-hq.state', 'http://127.0.0.1:47821', '{"chat":"first"}');
    storage.flush();
    storage = createStateStorage(directory);
    expect(storage.read('agent-hq.state', 'http://127.0.0.1:47821').restore).toBe(false);
    expect(storage.read('agent-hq.state', 'http://127.0.0.1:47822')).toEqual({ restore: true, value: '{"chat":"first"}' });
    storage.write('agent-hq.state', 'http://127.0.0.1:47822', '{"chat":"latest"}');
    expect(storage.read('agent-hq.state', 'http://127.0.0.1:47821')).toEqual({ restore: true, value: '{"chat":"latest"}' });
  });

  it('retains explicit deletion so an older port cannot bring deleted data back', () => {
    storage.write('agent-hq.state', 'http://127.0.0.1:47821', '{"chat":"old"}');
    storage.write('agent-hq.state', 'http://127.0.0.1:47821', null);
    storage.flush();
    expect(createStateStorage(directory).read('agent-hq.state', 'http://127.0.0.1:47822')).toEqual({ restore: true, value: null });
  });

  it('keeps keys separate and refuses unknown paths and oversized state', () => {
    expect(storage.write('../outside', 'http://127.0.0.1:47821', 'bad')).toBe(false);
    expect(storage.write('agent-hq.state', 'http://127.0.0.1:47821', 'x'.repeat(16 * 1024 * 1024))).toBe(false);
    storage.write('agent-hq.layout', 'http://127.0.0.1:47821', '{"width":240}');
    expect(storage.read('agent-hq.state', 'http://127.0.0.1:47822').restore).toBe(false);
    storage.flush();
    expect(fs.readdirSync(directory)).toEqual(['agent-hq.layout.json']);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(directory, 'agent-hq.layout.json')).mode & 0o777).toBe(0o600);
  });

  it('uses browser state for first migration or a damaged backup', () => {
    expect(storage.read('agent-hq.state', 'http://127.0.0.1:47821').restore).toBe(false);
    fs.writeFileSync(path.join(directory, 'agent-hq.connections.json'), '{broken');
    expect(storage.read('agent-hq.connections', 'http://127.0.0.1:47822').restore).toBe(false);
  });
});

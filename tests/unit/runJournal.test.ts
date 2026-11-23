import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearJournal, loadJournal, saveJournal } from '../../server/runJournal';
import { restorableFromJournal } from '@/engine/runJournal';

describe('server run journal', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-journal-'));
    process.env.AGENT_HQ_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.AGENT_HQ_CONFIG_DIR;
  });

  it('round-trips a mission per project and keeps projects apart', () => {
    saveJournal('/work/a', { id: 'run-a' });
    saveJournal('/work/b', { id: 'run-b' });
    expect(loadJournal('/work/a')?.mission).toEqual({ id: 'run-a' });
    expect(loadJournal('/work/b')?.mission).toEqual({ id: 'run-b' });
    expect(loadJournal('/work/c')).toBeNull();
  });

  it('overwrites atomically, clears, and survives a corrupt file', () => {
    saveJournal('/work/a', { id: 1 });
    saveJournal('/work/a', { id: 2 });
    expect(loadJournal('/work/a')?.mission).toEqual({ id: 2 });
    const file = path.join(dir, 'runs', fs.readdirSync(path.join(dir, 'runs'))[0]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.join(dir, 'runs')).some((name) => name.endsWith('.tmp'))).toBe(false);
    fs.writeFileSync(file, '{ broken');
    expect(loadJournal('/work/a')).toBeNull();
    saveJournal('/work/a', { id: 3 });
    clearJournal('/work/a');
    expect(loadJournal('/work/a')).toBeNull();
  });

  it('refuses a journal over the size cap', () => {
    expect(() => saveJournal('/work/a', { blob: 'x'.repeat(5 * 1024 * 1024) })).toThrow(/too large/);
  });
});

describe('restoring from the journal', () => {
  const base = { id: 'r', title: 'Run', source: 'live', tasks: [{ id: 't1', status: 'in_progress', progress: 30 }, { id: 't2', status: 'completed', progress: 100 }] };

  it('brings back an unfinished run with mid-flight work reset', () => {
    const restored = restorableFromJournal({ ...base, status: 'running' });
    expect(restored).toMatchObject({ status: 'cancelled', interrupted: true });
    expect(restored?.tasks.map((task) => task.status)).toEqual(['pending', 'completed']);
  });

  it('does not bring back finished, demo or malformed runs', () => {
    expect(restorableFromJournal({ ...base, status: 'completed' })).toBeNull();
    expect(restorableFromJournal({ ...base, status: 'running', source: 'demo' })).toBeNull();
    expect(restorableFromJournal({ ...base, status: 'running', tasks: 'nope' })).toBeNull();
    expect(restorableFromJournal(null)).toBeNull();
  });
});

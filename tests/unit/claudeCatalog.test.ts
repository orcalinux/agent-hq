import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeModelId, readClaudeCatalog } from '../../server/claudeCatalog';
import { claudeModelChoices } from '../../server/cliModelIdentity';

describe('Claude Code account catalog', () => {
  let dir: string;
  const account = { organizationUuid: 'fixture-org', accountUuid: 'fixture-account' };
  const nameOf = (id: string) => `fixture-org-${createHash('sha256').update(id).digest('hex').slice(0, 12)}-cc.json`;
  const write = (file: string, value: unknown) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const catalog = (models: unknown[]) => ({ version: 2, catalog: { surface: 'cc', config: { models } } });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-claude-catalog-'));
    fs.mkdirSync(path.join(dir, 'cache/model-catalog'), { recursive: true });
    write('.claude.json', { oauthAccount: account });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads exact names, versions and capabilities only from the signed-in account’s catalog', () => {
    write(`cache/model-catalog/${nameOf(account.accountUuid)}`, catalog([
      { id: 'claude-opus-5-5', name: 'Opus 5.5', runtime: { max_input_tokens: 1000000, capabilities: ['mm_images'] } },
      { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
      { id: 'opus', name: 'Alias' },
    ]));
    write(`cache/model-catalog/${nameOf('another-account')}`, catalog([{ id: 'claude-secret-9-9', name: 'Other account' }]));
    expect(readClaudeCatalog(dir).models).toEqual([
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1000000, capabilities: ['chat', 'vision'] },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', contextWindow: undefined, capabilities: ['chat'] },
    ]);
  });

  it('merges older account caches, drops disabled and denied models, and strips context suffixes', () => {
    write('.claude.json', {
      oauthAccount: account,
      additionalModelOptionsCache: [
        { value: 'claude-fable-5-2[1m]', label: 'Fable 5.2' },
        { value: 'claude-disabled-5-5', label: 'Disabled', disabled: true },
      ],
      modelAccessCache: [
        { apiName: 'claude-denied-5-5', entitled: false },
        { apiName: 'claude-entitled-5-5', entitled: true },
      ],
    });
    write(`cache/model-catalog/${nameOf(account.accountUuid)}`, catalog([
      { id: 'claude-denied-5-5', name: 'Denied 5.5' },
      { id: 'claude-fable-5-2', name: 'Fable 5.2' },
    ]));
    const snapshot = readClaudeCatalog(dir);
    expect(snapshot.models.map((model) => model.id)).toEqual(['claude-fable-5-2', 'claude-entitled-5-5']);
    const choices = claudeModelChoices({
      providerId: 'anthropic', method: 'cli', connectedAt: '',
      cliModelObservation: { cwd: '/project', models: { default: ['claude-denied-5-5'] } },
    }, '/project', snapshot);
    expect(choices.some((model) => model.id === 'claude-denied-5-5')).toBe(false);
    expect(choices.find((model) => model.id === 'default')?.canonicalRef).toBeUndefined();
  });

  it('handles missing files, malformed JSON and unknown catalog formats without inventing models', () => {
    expect(readClaudeCatalog(dir).models).toEqual([]);
    write(`cache/model-catalog/${nameOf(account.accountUuid)}`, { version: 3, catalog: { surface: 'cc', config: { models: [{ id: 'claude-unknown-5' }] } } });
    expect(readClaudeCatalog(dir).models).toEqual([]);
    fs.writeFileSync(path.join(dir, '.claude.json'), '{unfinished');
    expect(readClaudeCatalog(dir).models).toEqual([]);
  });

  it('rejects alias IDs and invalid model names', () => {
    for (const id of ['default', 'opus', 'sonnet', 'haiku', '../claude-opus-5-5', 'claude/bad', null, 42]) expect(claudeModelId(id)).toBeUndefined();
    expect(claudeModelId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { StoredConnection } from '../../server/config';
import { claudeModelChoices, observeCliModels, reportedClaudeModels } from '../../server/cliModelIdentity';
import { chat, discoverModels, verifyConnection } from '../../server/providers';

const connection = (): StoredConnection => ({ providerId: 'anthropic', method: 'cli', connectedAt: '2026-11-20' });
const emptyCatalog = { models: [], deniedIds: [] };

describe('Claude CLI model identity', () => {
  it('uses reported model IDs rather than guessing a version from an alias', () => {
    expect(reportedClaudeModels({ modelUsage: { 'claude-opus-4-6': {}, 'claude-haiku-4-5-20251001': {} } }))
      .toEqual(['claude-opus-4-6', 'claude-haiku-4-5-20251001']);
    for (const modelUsage of [undefined, null, 'opus', [], { '': {}, ' opus ': {} }]) {
      expect(reportedClaudeModels({ modelUsage })).toEqual([]);
    }
    expect(claudeModelChoices(connection(), '/project', emptyCatalog).every((model) => model.selectable === false)).toBe(true);
  });

  it('maps old assignments to exact model choices while keeping compatibility entries hidden', () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    const models = claudeModelChoices(JSON.parse(JSON.stringify(conn)), '/project', emptyCatalog);
    expect(models.find((model) => model.id === 'default')).toMatchObject({
      id: 'default',
      name: 'claude-opus-4-6',
      selectable: false,
      canonicalRef: 'anthropic:cli:claude-opus-4-6',
    });
    expect(models.filter((model) => model.selectable).map((model) => model.id)).toEqual(['claude-opus-4-6']);
  });

  it('updates aliases independently, preserves multiple reported models and deduplicates exact choices', () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    observeCliModels(conn, '/project', 'cli:sonnet', ['claude-sonnet-4-6', 'claude-haiku-4-5']);
    observeCliModels(conn, '/project', 'cli:opus', ['claude-opus-4-6']);
    const choices = claudeModelChoices(conn, '/project', emptyCatalog);
    expect(choices.find((model) => model.id === 'sonnet')?.name).toBe('claude-sonnet-4-6 + claude-haiku-4-5');
    expect(choices.find((model) => model.id === 'sonnet')?.canonicalRef).toBeUndefined();
    expect(choices.filter((model) => model.id === 'claude-opus-4-6')).toHaveLength(1);
    observeCliModels(conn, '/project', 'cli:sonnet', ['claude-sonnet-new']);
    expect(claudeModelChoices(conn, '/project', emptyCatalog).find((model) => model.id === 'sonnet')?.name).toContain('claude-sonnet-new');
  });

  it('does not attribute one project’s model selection to a different project', () => {
    const conn = connection();
    observeCliModels(conn, '/first', 'cli:default', ['claude-opus-4-6']);
    expect(claudeModelChoices(conn, '/second', emptyCatalog).find((model) => model.id === 'default')?.canonicalRef).toBeUndefined();
    observeCliModels(conn, '/second', 'cli:sonnet', ['claude-sonnet-4-6']);
    expect(claudeModelChoices(conn, '/second', emptyCatalog).find((model) => model.id === 'default')?.canonicalRef).toBeUndefined();
  });

  it('keeps observations when metadata is absent and leaves other providers untouched', () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    observeCliModels(conn, '/project', 'cli:default', []);
    expect(claudeModelChoices(conn, '/project', emptyCatalog).find((model) => model.id === 'default')?.name).toContain('claude-opus-4-6');
    const other: StoredConnection = { ...connection(), providerId: 'openai' };
    observeCliModels(other, '/project', 'cli:default', ['unexpected']);
    expect(other.cliModelObservation).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('reads identity from CLI JSON during verification and sends exact IDs unchanged', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-model-'));
    const binary = 'claude';
    fs.writeFileSync(path.join(dir, binary), `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  console.log('fixture CLI 1.0');
} else {
  process.stdin.resume();
  process.stdin.on('end', () => {
    const index = process.argv.indexOf('--model');
    const model = index < 0 ? 'claude-opus-fixture' : process.argv[index + 1];
    console.log(JSON.stringify({result: 'OK', modelUsage: {[model]: {}}, usage: {input_tokens: 1, output_tokens: 1}}));
  });
}
`, { mode: 0o755 });
    vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv('CLAUDE_CONFIG_DIR', dir);
    try {
      const conn = { ...connection(), cliBinary: 'not-an-approved-provider-cli' };
      const verified = await verifyConnection(conn, dir);
      expect(verified.models[0]).toMatchObject({ name: 'claude-opus-fixture', selectable: true });
      expect((await discoverModels(conn, dir))[0].id).toBe('cli:claude-opus-fixture');
      const result = await chat({
        connection: conn,
        cwd: dir,
        model: 'cli:claude-sonnet-fixture',
        messages: [{ role: 'user', content: 'OK' }],
        signal: new AbortController().signal,
        onDelta: () => {},
      });
      expect(result.resolvedModels).toEqual(['claude-sonnet-fixture']);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

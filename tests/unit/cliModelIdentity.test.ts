import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { StoredConnection } from '../../server/config';
import { claudeModelChoices, observeCliModels, reportedClaudeModels } from '../../server/cliModelIdentity';
import { chat, discoverModels, verifyConnection } from '../../server/providers';

const connection = (): StoredConnection => ({ providerId: 'anthropic', method: 'cli', connectedAt: '2026-11-20' });

describe('Claude CLI model identity', () => {
  it('uses reported model IDs rather than guessing a version from an alias', () => {
    expect(reportedClaudeModels({ modelUsage: { 'claude-opus-4-6': {}, 'claude-haiku-4-5-20251001': {} } }))
      .toEqual(['claude-opus-4-6', 'claude-haiku-4-5-20251001']);
    for (const modelUsage of [undefined, null, 'opus', [], { '': {}, ' opus ': {} }]) {
      expect(reportedClaudeModels({ modelUsage })).toEqual([]);
    }
    expect(claudeModelChoices(connection(), '/project')[0][1]).toContain('verify to identify');
  });

  it('preserves automatic assignments while exposing exact models as selectable options', async () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    const models = await discoverModels(JSON.parse(JSON.stringify(conn)), '/project');
    expect(models[0]).toMatchObject({
      ref: 'anthropic:cli:default',
      id: 'cli:default',
      name: 'claude-opus-4-6 · last used (automatic)',
    });
    expect(models.find((model) => model.ref === 'anthropic:cli:claude-opus-4-6'))
      .toMatchObject({ name: 'claude-opus-4-6 · Claude Code' });
    expect(models.find((model) => model.id === 'cli:sonnet')?.name).toBe('Claude Sonnet · alias');
  });

  it('updates aliases independently, preserves multiple reported models and deduplicates exact choices', () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    observeCliModels(conn, '/project', 'cli:sonnet', ['claude-sonnet-4-6', 'claude-haiku-4-5']);
    observeCliModels(conn, '/project', 'cli:opus', ['claude-opus-4-6']);
    const choices = claudeModelChoices(conn, '/project');
    expect(choices[1][1]).toBe('claude-sonnet-4-6 + claude-haiku-4-5 · last used (sonnet alias)');
    expect(choices.filter(([id]) => id === 'claude-opus-4-6')).toHaveLength(1);
    observeCliModels(conn, '/project', 'cli:sonnet', ['claude-sonnet-new']);
    expect(claudeModelChoices(conn, '/project')[1][1]).toContain('claude-sonnet-new');
  });

  it('does not attribute one project’s model selection to a different project', () => {
    const conn = connection();
    observeCliModels(conn, '/first', 'cli:default', ['claude-opus-4-6']);
    expect(claudeModelChoices(conn, '/second')[0][1]).toContain('verify to identify');
    observeCliModels(conn, '/second', 'cli:sonnet', ['claude-sonnet-4-6']);
    expect(claudeModelChoices(conn, '/second')[0][1]).toContain('verify to identify');
  });

  it('keeps observations when metadata is absent and leaves other providers untouched', () => {
    const conn = connection();
    observeCliModels(conn, '/project', 'cli:default', ['claude-opus-4-6']);
    observeCliModels(conn, '/project', 'cli:default', []);
    expect(claudeModelChoices(conn, '/project')[0][1]).toContain('claude-opus-4-6');
    const other: StoredConnection = { ...connection(), providerId: 'openai' };
    observeCliModels(other, '/project', 'cli:default', ['unexpected']);
    expect(other.cliModelObservation).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('reads identity from CLI JSON during verification and sends exact IDs unchanged', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-model-'));
    const binary = 'fixture-claude';
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
    try {
      const conn = { ...connection(), cliBinary: binary };
      const verified = await verifyConnection(conn, dir);
      expect(verified.models[0].name).toContain('claude-opus-fixture');
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

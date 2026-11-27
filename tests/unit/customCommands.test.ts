import { afterEach, describe, expect, it } from 'vitest';
import {
  expandCustomCommandTemplate,
  helpText,
  interpretChatCommand,
  normalizeCustomCommands,
  parseChatCommand,
  parseCommandArgs,
  validateCustomCommandInput,
  type ChatCommandContext,
} from '@/engine/chatCommands';
import { chatSuggestions, completionToken } from '@/utils/chatCompletion';
import { useAgentStore } from '@/store/useAgentStore';

const baseCtx: ChatCommandContext = {
  mode: 'ask',
  approval: 'auto',
  strategy: 'adaptive',
  running: false,
  sovereignModel: 'anthropic:claude',
  activeFile: 'server/api.ts',
  projectName: 'agent-hq',
};

describe('custom slash command validation and normalization', () => {
  it('normalizes leading slashes and casing, and rejects reserved, duplicate, or invalid slugs', () => {
    const existing = [
      { id: 'cmd-audit', name: 'audit', description: 'Security check', template: 'Audit {{input}}' },
    ];

    expect(validateCustomCommandInput({ name: ' /Review-PR ', description: '  PR checklist  ', template: 'Check {{input}}', mode: 'plan' }, existing)).toEqual({
      ok: true,
      value: { name: 'review-pr', description: 'PR checklist', template: 'Check {{input}}', mode: 'plan' },
    });

    expect(validateCustomCommandInput({ name: 'plan', template: 'x' }, existing)).toMatchObject({
      ok: false,
      field: 'name',
      error: expect.stringContaining('built-in'),
    });

    expect(validateCustomCommandInput({ name: '/remember', template: 'x' }, existing)).toMatchObject({
      ok: false,
      field: 'name',
      error: expect.stringContaining('built-in'),
    });

    expect(validateCustomCommandInput({ name: 'audit', template: 'other' }, existing)).toMatchObject({
      ok: false,
      field: 'name',
      error: expect.stringContaining('already exists'),
    });

    // Updating the same command ID keeps its own name valid.
    expect(validateCustomCommandInput({ name: 'audit', template: 'Updated {{input}}' }, existing, 'cmd-audit')).toMatchObject({
      ok: true,
      value: { name: 'audit', template: 'Updated {{input}}' },
    });

    expect(validateCustomCommandInput({ name: '123bad', template: 'x' }, existing)).toMatchObject({
      ok: false,
      field: 'name',
    });

    expect(validateCustomCommandInput({ name: 'lint-check', template: '   ' }, existing)).toMatchObject({
      ok: false,
      field: 'template',
    });

    expect(validateCustomCommandInput({ name: 'huge', template: 'x'.repeat(4001) }, existing)).toMatchObject({
      ok: false,
      field: 'template',
    });
  });

  it('drops reserved, malformed, or duplicate entries during persistence normalization', () => {
    const normalized = normalizeCustomCommands([
      { id: '1', name: 'plan', description: 'bad', template: 'hi' },
      { id: '2', name: '/sec-audit', description: 'ok', template: 'Scan {{file}}', mode: 'ask' },
      { id: '3', name: 'sec-audit', description: 'dup', template: 'Other' },
      { id: '4', name: 'empty', description: '', template: '   ' },
      null,
    ]);
    expect(normalized).toEqual([
      { id: '2', name: 'sec-audit', description: 'ok', template: 'Scan {{file}}', mode: 'ask' },
    ]);
  });
});

describe('custom command template expansion', () => {
  it('interpolates {{input}}, $ARGUMENTS, positional $1..$9 (with quotes), {{file}}, and {{project}}', () => {
    expect(parseCommandArgs('"login flow" server/auth.ts \'edge cases\'')).toEqual([
      'login flow',
      'server/auth.ts',
      'edge cases',
    ]);

    const expanded = expandCustomCommandTemplate(
      'Project={{project}} File={{file}} Target=$1 Extra=$2 Full={{input}} Alias=$ARGUMENTS Missing=$3',
      '"auth module" strict',
      { file: 'server/auth.ts', project: 'agent-hq' },
    );
    expect(expanded).toBe(
      'Project=agent-hq File=server/auth.ts Target=auth module Extra=strict Full="auth module" strict Alias="auth module" strict Missing=',
    );
  });

  it('expands in a single pass so user input containing placeholders is not re-expanded', () => {
    const expanded = expandCustomCommandTemplate(
      'Check $1 in {{file}}: {{input}}',
      'literal {{project}} and $2',
      { file: 'src/app.ts', project: 'agent-hq' },
    );
    expect(expanded).toBe('Check literal in src/app.ts: literal {{project}} and $2');
  });

  it('appends trailing user input when the template omits input placeholders', () => {
    expect(expandCustomCommandTemplate('Review error handling in {{project}}.', 'focus on timeouts', { project: 'agent-hq' })).toBe(
      'Review error handling in agent-hq.\n\nfocus on timeouts',
    );
    expect(expandCustomCommandTemplate('Review error handling in {{project}}.', '', { project: 'agent-hq' })).toBe(
      'Review error handling in agent-hq.',
    );
  });
});

describe('custom command parsing, execution, completion, and store integration', () => {
  afterEach(() => {
    for (const cmd of useAgentStore.getState().customCommands) {
      useAgentStore.getState().removeCustomCommand(cmd.id);
    }
  });

  it('parses, interprets, completes, and lists custom commands alongside built-ins', () => {
    const customCommands = [
      {
        id: 'cmd-1',
        name: 'audit',
        description: 'Security audit in Plan mode',
        template: 'Audit {{input}} in {{project}} focusing on {{file}}.',
        mode: 'plan' as const,
      },
      {
        id: 'cmd-2',
        name: 'only-args',
        description: 'Requires $1',
        template: '$1',
      },
    ];

    expect(parseChatCommand('/audit auth endpoints', customCommands)).toEqual({
      name: 'audit',
      rest: 'auth endpoints',
    });
    // File paths starting with a matching prefix are not treated as slash commands.
    expect(parseChatCommand('/audit/file.ts check', customCommands)).toBeNull();

    const res = interpretChatCommand(parseChatCommand('/audit auth endpoints', customCommands)!, {
      ...baseCtx,
      customCommands,
    });
    expect(res).toEqual({
      actions: [{ type: 'mode', mode: 'plan' }],
      prompt: 'Audit auth endpoints in agent-hq focusing on server/api.ts.',
    });

    const emptyRes = interpretChatCommand(parseChatCommand('/only-args', customCommands)!, {
      ...baseCtx,
      customCommands,
    });
    expect(emptyRes.error).toContain('empty prompt');

    const help = helpText(customCommands);
    expect(help).toContain('Custom commands:');
    expect(help).toContain('/audit [input] · Security audit in Plan mode (plan)');

    const suggestions = chatSuggestions(completionToken('/au', 3)!, [], { customCommands });
    expect(suggestions).toEqual([
      {
        id: 'custom-audit',
        label: '/audit',
        detail: 'Security audit in Plan mode · plan mode · custom',
        insert: '/audit',
        hasArgs: false,
      },
    ]);
  });

  it('adds, updates, and removes custom commands in useAgentStore', () => {
    const store = useAgentStore.getState();
    const added = store.upsertCustomCommand({
      name: ' /triage ',
      description: 'Triage bugs',
      template: 'Triage {{input}}',
      mode: 'ask',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(useAgentStore.getState().customCommands).toHaveLength(1);

    const updated = useAgentStore.getState().upsertCustomCommand({
      id: added.command.id,
      name: 'triage',
      description: 'Updated triage',
      template: 'Plan triage for {{input}}',
      mode: 'plan',
    });
    expect(updated).toMatchObject({
      ok: true,
      command: { id: added.command.id, name: 'triage', description: 'Updated triage', mode: 'plan' },
    });

    const collision = useAgentStore.getState().upsertCustomCommand({ name: 'status', template: 'bad' });
    expect(collision).toMatchObject({ ok: false, field: 'name' });

    useAgentStore.getState().removeCustomCommand(added.command.id);
    expect(useAgentStore.getState().customCommands).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { helpText, interpretChatCommand, parseChatCommand, type ChatCommandContext } from '@/engine/chatCommands';
import { CHAT_COMMAND_SPECS, applyCompletion, chatSuggestions, completionToken } from '@/utils/chatCompletion';

const ctx: ChatCommandContext = { mode: 'ask', approval: 'auto', strategy: 'adaptive', running: false, sovereignModel: 'anthropic:claude' };
const run = (text: string, over: Partial<ChatCommandContext> = {}) => interpretChatCommand(parseChatCommand(text)!, { ...ctx, ...over });

describe('chat command parsing', () => {
  it('ignores plain text, unknown commands and /remember', () => {
    for (const text of ['hello', '/unknown', '/remember x', 'say /plan', '/planning']) expect(parseChatCommand(text)).toBeNull();
  });
  it('reads name and rest, case-insensitively', () => {
    expect(parseChatCommand('/PLAN build a login page')).toEqual({ name: 'plan', rest: 'build a login page' });
    expect(parseChatCommand('  /status ')).toEqual({ name: 'status', rest: '' });
  });
});

describe('chat command behaviour', () => {
  it('/plan switches mode, and sends text when given', () => {
    expect(run('/plan')).toMatchObject({ actions: [{ type: 'mode', mode: 'plan' }], reply: expect.any(String) });
    const withPrompt = run('/build add a README');
    expect(withPrompt.actions).toEqual([{ type: 'mode', mode: 'build' }]);
    expect(withPrompt.prompt).toBe('add a README');
  });
  it('/approval only tightens; loosening needs the picker', () => {
    expect(run('/approval ask').actions).toEqual([{ type: 'approval', mode: 'ask' }]);
    expect(run('/approval full').error).toMatch(/picker/);
    expect(run('/approval full').actions).toEqual([]);
    expect(run('/approval nope').error).toMatch(/ask, auto or full/);
    expect(run('/approval auto').reply).toMatch(/already/);
  });
  it('/team, /open, /resume and /stop validate their input', () => {
    expect(run('/team fixed').actions).toEqual([{ type: 'strategy', strategy: 'fixed' }]);
    expect(run('/team').error).toBeTruthy();
    expect(run('/open reports').actions).toEqual([{ type: 'open', view: 'reports' }]);
    expect(run('/open mars').error).toBeTruthy();
    expect(run('/resume', { running: true }).error).toMatch(/already/);
    expect(run('/resume').actions).toEqual([{ type: 'resume' }]);
    expect(run('/stop').actions).toEqual([{ type: 'stop' }]);
  });
  it('/clear and /new are the same, /status and /help only reply', () => {
    expect(run('/new').actions).toEqual([{ type: 'clear' }]);
    expect(run('/status').reply).toContain('Approval: auto');
    expect(run('/status', { sovereignModel: '' }).reply).toContain('not set');
    expect(helpText()).toContain('/approval <ask|auto|full>');
    expect(helpText()).not.toContain('/new ·');
  });
});

describe('argument completion', () => {
  it('offers options after a command with arguments and replaces only the argument', () => {
    const token = completionToken('/approval a', 11)!;
    expect(token).toMatchObject({ kind: 'argument', command: 'approval', query: 'a' });
    expect(chatSuggestions(token, []).map((item) => item.insert)).toEqual(['ask', 'auto']);
    expect(applyCompletion('/approval a', token, chatSuggestions(token, [])[0]).text).toBe('/approval ask ');
    expect(completionToken('/open ', 6)).toMatchObject({ kind: 'argument', command: 'open', query: '' });
    expect(chatSuggestions(completionToken('/open ', 6)!, [])).toHaveLength(7);
  });
  it('does not offer arguments for commands without them', () => {
    expect(completionToken('/status x', 9)).toBeNull();
    expect(completionToken('/plan hello', 11)).toBeNull();
  });
  it('lists every command, marking those that take arguments', () => {
    const all = chatSuggestions(completionToken('/', 1)!, []);
    expect(all).toHaveLength(CHAT_COMMAND_SPECS.length);
    expect(all.find((item) => item.id === 'team')?.hasArgs).toBe(true);
    expect(all.find((item) => item.id === 'help')?.hasArgs).toBe(false);
  });
});

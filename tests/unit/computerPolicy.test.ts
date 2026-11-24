import { describe, expect, it } from 'vitest';
import {
  compactToolHistory, computerInstructions, describeComputerAction, formatComputerResult, isComputerAction, parseComputerRequest, validateComputerCall,
} from '@/engine/computerPolicy';
import type { ComputerTool } from '@/types/computerUse';

describe('computer tool policy', () => {
  it('refuses everything while access is off and actions while it is read only', () => {
    expect(() => validateComputerCall('off', 'list_windows', {})).toThrow(/off/);
    expect(() => validateComputerCall('read', 'click', { pid: 1, element_token: 's00000001:1' })).toThrow(/not allowed/);
    expect(() => validateComputerCall('read', 'get_window_state', { pid: 1 })).not.toThrow();
    expect(() => validateComputerCall('control', 'click', { pid: 1, element_token: 's00000001:1' })).not.toThrow();
  });

  it('offers only listed tools and arguments', () => {
    expect(() => validateComputerCall('control', 'run_steps', {})).toThrow(/not allowed/);
    expect(() => validateComputerCall('control', 'constructor', {})).toThrow(/not allowed/);
    expect(() => validateComputerCall('control', 'click', { pid: 1, x: 10, y: 20 })).toThrow(/Unsupported arguments for click: x, y/);
    expect(() => validateComputerCall('read', 'get_window_state', { pid: 1, include_screenshot: true })).toThrow(/include_screenshot/);
    expect(() => validateComputerCall('read', 'get_window_state', { pid: 1, screenshot_out_file: '/tmp/a.png' })).toThrow(/screenshot_out_file/);
    expect(() => validateComputerCall('read', 'list_apps', { session: 'other' })).toThrow(/session/);
    expect(() => validateComputerCall('control', 'type_text', ['a'])).toThrow(/object/);
  });

  it('requires a target and a well-formed token from a read', () => {
    expect(() => validateComputerCall('control', 'click', { pid: 1 })).toThrow(/element_token\. Read the window first/);
    expect(() => validateComputerCall('control', 'click', { pid: 1, element_token: '../x' })).toThrow(/latest get_window_state/);
    expect(() => validateComputerCall('control', 'press_key', { key: 'Return' })).toThrow(/needs pid/);
    expect(isComputerAction('type_text')).toBe(true);
    expect(isComputerAction('get_window_state')).toBe(false);
  });
});

describe('computer-call replies', () => {
  it('treat a reply without a block as the final answer', () => {
    expect(parseComputerRequest('Done. The form is filled.')).toBeNull();
  });

  it('read exactly one block', () => {
    expect(parseComputerRequest('Reading first.\n```computer-call\n{"name":"list_windows","arguments":{}}\n```')).toEqual({ request: { name: 'list_windows', arguments: {} } });
    expect(parseComputerRequest('```computer-call\n{"name":"list_apps"}\n```')).toEqual({ request: { name: 'list_apps', arguments: {} } });
    expect(parseComputerRequest('```computer-call\n{"name":"a"}\n```\n```computer-call\n{"name":"b"}\n```')).toMatchObject({ error: expect.stringMatching(/exactly one/) });
    expect(parseComputerRequest('```computer-call\n{name: list}\n```')).toMatchObject({ error: expect.stringMatching(/JSON/) });
    expect(parseComputerRequest('```computer-call\n{"name":"click","arguments":[1]}\n```')).toMatchObject({ error: expect.stringMatching(/object/) });
  });

  it('log actions without the typed text', () => {
    expect(describeComputerAction({ name: 'type_text', arguments: { pid: 4, element_token: 's00000001:0', text: 'secret password' } })).toBe('type_text s00000001:0 (15 characters)');
    expect(describeComputerAction({ name: 'press_key', arguments: { pid: 4, key: 'Return' } })).toBe('press_key Return');
  });
});

describe('desktop prompt and history', () => {
  const tools: ComputerTool[] = [
    { name: 'get_window_state', description: 'Read a window.', kind: 'read', schema: { properties: { pid: { type: 'integer' }, query: { type: 'string' } }, required: ['pid'] } },
    { name: 'click', description: 'Click an element.', kind: 'action', schema: { properties: { pid: { type: 'integer' }, button: { enum: ['left', 'right'] } }, required: ['pid'] } },
  ];

  it('lists the offered tools and earlier actions', () => {
    const text = computerInstructions(tools, ['click s00000001:1']);
    expect(text).toContain('read and control');
    expect(text).toContain('get_window_state(pid: integer, query?: string): Read a window.');
    expect(text).toContain('button?: "left"|"right"');
    expect(text).toContain('already did these desktop actions: click s00000001:1');
    expect(computerInstructions([tools[0]])).toContain('read only');
  });

  it('cuts long results and shortens all but the latest ones', () => {
    expect(formatComputerResult('get_window_state', 'x'.repeat(50), 10)).toMatch(/^Result of get_window_state:\nx{10}\n… \(40 more characters cut/);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: 'task '.repeat(200) }];
    for (let i = 0; i < 5; i++) messages.push({ role: 'assistant', content: 'call' }, { role: 'user', content: `Result of read ${i}\n${'y'.repeat(1000)}` });
    compactToolHistory(messages);
    expect(messages[0].content.length).toBe(1000);
    expect(messages.filter((m) => m.content.includes('older result shortened'))).toHaveLength(2);
    expect(messages.at(-1)!.content.length).toBeGreaterThan(1000);
  });
});

import type { ComputerAccess, ComputerTool } from '../types/computerUse';
import { hostToolBlocks } from './toolBlocks';

interface ToolPolicy {
  kind: 'read' | 'action';
  allowed: string[];
  required: string[];
}

const TARGET = ['pid', 'window_id', 'element_token', 'delivery_mode'];

/** The driver tools Agent HQ offers, with the only arguments each may carry. Pixel coordinates, screenshots, files and sessions are left out. */
export const COMPUTER_TOOL_POLICY: Record<string, ToolPolicy> = {
  list_apps: { kind: 'read', allowed: [], required: [] },
  list_windows: { kind: 'read', allowed: ['app', 'on_screen_only', 'pid'], required: [] },
  get_window_state: { kind: 'read', allowed: ['pid', 'window_id', 'query', 'max_depth', 'max_elements'], required: ['pid'] },
  click: { kind: 'action', allowed: [...TARGET, 'button', 'count'], required: ['pid', 'element_token'] },
  type_text: { kind: 'action', allowed: [...TARGET, 'text', 'delay_ms'], required: ['pid', 'text'] },
  press_key: { kind: 'action', allowed: [...TARGET, 'key', 'modifiers'], required: ['pid', 'key'] },
  scroll: { kind: 'action', allowed: [...TARGET, 'direction', 'amount', 'by'], required: ['pid', 'direction'] },
  set_value: { kind: 'action', allowed: [...TARGET, 'value'], required: ['pid', 'element_token', 'value'] },
};

/** Most model turns one task may spend on desktop tools before it must answer. */
export const MAX_COMPUTER_STEPS = 24;

export function isComputerAction(name: string): boolean {
  return COMPUTER_TOOL_POLICY[name]?.kind === 'action';
}

export function validateComputerCall(mode: ComputerAccess, name: string, args: unknown): asserts args is Record<string, unknown> {
  if (mode === 'off') throw new Error('Computer access is off.');
  const policy = Object.prototype.hasOwnProperty.call(COMPUTER_TOOL_POLICY, name) ? COMPUTER_TOOL_POLICY[name] : undefined;
  if (!policy || (policy.kind === 'action' && mode !== 'control')) throw new Error(`The computer tool "${name}" is not allowed by the current access setting.`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Computer tool arguments must be an object.');
  const values = args as Record<string, unknown>;
  const extra = Object.keys(values).filter((key) => !policy.allowed.includes(key));
  if (extra.length) throw new Error(`Unsupported arguments for ${name}: ${extra.join(', ')}. Pixel coordinates, screenshots, files and sessions are not offered.`);
  const missing = policy.required.filter((key) => values[key] === undefined || values[key] === '');
  if (missing.length) throw new Error(`${name} needs ${missing.join(', ')}.${missing.includes('element_token') ? ' Read the window first and use an element token from that read.' : ''}`);
  if (values.element_token !== undefined && (typeof values.element_token !== 'string' || !/^s[0-9a-f]{8}:[0-9]+$/.test(values.element_token))) {
    throw new Error('element_token must come from the latest get_window_state read, like "s0000002a:11".');
  }
}

export interface ComputerRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export type ParsedComputerRequest = { request: ComputerRequest } | { error: string } | null;

/** Finds the one ```computer-call block in a reply. Returns null when the reply is a final answer. */
export function parseComputerRequest(text: string): ParsedComputerRequest {
  const { blocks, unclosed } = hostToolBlocks(text, 'computer-call');
  if (unclosed) return { error: 'Close the computer-call block with ```.' };
  if (!blocks.length) return null;
  if (blocks.length > 1) return { error: 'Send exactly one computer-call block per reply, then wait for its result.' };
  let value: unknown;
  try { value = JSON.parse(blocks[0]); } catch { return { error: 'The computer-call block is not valid JSON.' }; }
  const call = value as { name?: unknown; arguments?: unknown };
  if (!call || typeof call.name !== 'string') return { error: 'A computer-call needs a "name".' };
  const args = call.arguments ?? {};
  if (typeof args !== 'object' || Array.isArray(args) || args === null) return { error: '"arguments" must be an object.' };
  return { request: { name: call.name, arguments: args as Record<string, unknown> } };
}

function argumentList(tool: ComputerTool): string {
  const properties = (tool.schema.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown[] }>;
  const required = new Set((tool.schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([key, spec]) => {
    const type = spec.enum ? spec.enum.map((v) => JSON.stringify(v)).join('|') : String(spec.type ?? 'value');
    return `${key}${required.has(key) ? '' : '?'}: ${type}`;
  }).join(', ');
}

export function computerInstructions(tools: ComputerTool[], previousActions?: string[]): string {
  const canAct = tools.some((tool) => tool.kind === 'action');
  return `\n\nDesktop access (${canAct ? 'read and control' : 'read only'}): only if this task genuinely needs a desktop app, you may use these tools. They read the accessibility tree as text; there are no screenshots.
${tools.map((tool) => `- ${tool.name}(${argumentList(tool)}): ${tool.description}`).join('\n')}
To use one, reply with exactly one block and nothing after it, then wait for the result:
\`\`\`computer-call
{"name": "list_windows", "arguments": {}}
\`\`\`
Rules: read a window with get_window_state before acting, and use element tokens from your latest read only. ${canAct ? 'An action may not be confirmed; read again to check what changed instead of repeating it, since a repeat can double-fire. ' : ''}You have at most ${MAX_COMPUTER_STEPS} tool turns. When done, reply normally with no computer-call block.${
  previousActions?.length ? `\nAn earlier attempt of this task already did these desktop actions: ${previousActions.join('; ')}. Read the current state first and do not repeat them blindly.` : ''}`;
}

/** Keeps tool results small enough to send back, without breaking a token mid-line. */
export function formatComputerResult(name: string, result: unknown, limit = 12_000): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
  const clipped = text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters cut; narrow the read with query or max_depth)` : text;
  return `Result of ${name}:\n${clipped}`;
}

/** What the log and the task keep about an action: the tool and target, never the typed text. */
export function describeComputerAction(request: ComputerRequest): string {
  const target = request.arguments.element_token ? ` ${String(request.arguments.element_token)}` : '';
  const key = request.name === 'press_key' ? ` ${String(request.arguments.key)}` : '';
  const length = typeof request.arguments.text === 'string' ? ` (${request.arguments.text.length} characters)` : '';
  return `${request.name}${key}${target}${length}`;
}

/** Older tool results shrink to a short note so a long desktop session does not resend every tree it read. */
export function compactToolHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }>, keep = 3): void {
  const results = messages.map((message, index) => ({ message, index })).filter(({ message, index }) => index > 0 && message.role === 'user' && /^(Result of|Error from) /.test(message.content));
  for (const { message } of results.slice(0, -keep)) {
    if (message.content.length > 400) message.content = `${message.content.slice(0, 300)}\n… (older result shortened; read again for current state)`;
  }
}

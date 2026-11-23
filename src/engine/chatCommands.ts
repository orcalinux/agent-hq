import { CHAT_COMMAND_SPECS, CHAT_VIEWS } from '@/utils/chatCompletion';
import type { ApprovalMode, OrchestratorMode, TeamStrategy } from '@/types';

export interface ChatCommandContext {
  mode: OrchestratorMode;
  approval: ApprovalMode;
  strategy: TeamStrategy;
  running: boolean;
  sovereignModel: string;
}

export type ChatCommandAction =
  | { type: 'mode'; mode: OrchestratorMode }
  | { type: 'approval'; mode: ApprovalMode }
  | { type: 'strategy'; strategy: TeamStrategy }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'resume' }
  | { type: 'open'; view: string };

export interface ChatCommandResult {
  actions: ChatCommandAction[];
  reply?: string;
  error?: string;
  prompt?: string;
}

const APPROVAL_RANK: Record<ApprovalMode, number> = { ask: 0, auto: 1, full: 2 };
const MODE_LABEL: Record<OrchestratorMode, string> = { ask: 'Ask', plan: 'Plan', build: 'Build' };

/** Splits "/name rest". Returns null for plain text and for /remember, which has its own parser. */
export function parseChatCommand(text: string): { name: string; rest: string } | null {
  const match = /^\/([a-z]+)\b[ \t]*([\s\S]*)$/iu.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name === 'remember' || !CHAT_COMMAND_SPECS.some((spec) => spec.name === name)) return null;
  return { name, rest: match[2].trim() };
}

export function helpText(): string {
  const lines = CHAT_COMMAND_SPECS.filter((spec) => !spec.aliasOf).map((spec) => {
    const args = spec.args ? ` <${spec.args.map((arg) => arg.value).join('|')}>` : spec.acceptsText ? ' [text]' : '';
    return `/${spec.name}${args} · ${spec.detail}`;
  });
  return `Chat commands. Type / to pick one; Tab completes. Type @ to mention an agent.\n\n${lines.join('\n')}`;
}

export function interpretChatCommand(command: { name: string; rest: string }, ctx: ChatCommandContext): ChatCommandResult {
  const { name, rest } = command;
  const fail = (error: string): ChatCommandResult => ({ actions: [], error });
  switch (name) {
    case 'help':
      return { actions: [], reply: helpText() };
    case 'status':
      return {
        actions: [],
        reply: `Mode: ${MODE_LABEL[ctx.mode]} · Approval: ${ctx.approval} · Team: ${ctx.strategy} · Sovereign model: ${ctx.sovereignModel || 'not set'} · Run: ${ctx.running ? 'running' : 'idle'}`,
      };
    case 'clear':
    case 'new':
      return { actions: [{ type: 'clear' }] };
    case 'ask':
    case 'plan':
    case 'build':
      return {
        actions: [{ type: 'mode', mode: name }],
        ...(rest ? { prompt: rest } : { reply: `Switched to ${MODE_LABEL[name]} mode.` }),
      };
    case 'approval': {
      const wanted = rest.toLowerCase() as ApprovalMode;
      if (!(wanted in APPROVAL_RANK)) return fail('Use /approval ask, auto or full.');
      if (wanted === ctx.approval) return { actions: [], reply: `Approval is already ${wanted}.` };
      if (APPROVAL_RANK[wanted] > APPROVAL_RANK[ctx.approval]) return fail(`Loosening approvals needs your confirmation. Use the approval picker to switch to ${wanted}.`);
      return { actions: [{ type: 'approval', mode: wanted }], reply: `Approval set to ${wanted}.` };
    }
    case 'team': {
      const wanted = rest.toLowerCase();
      if (wanted !== 'adaptive' && wanted !== 'fixed') return fail('Use /team adaptive or /team fixed.');
      return { actions: [{ type: 'strategy', strategy: wanted }], reply: `Team strategy set to ${wanted}.` };
    }
    case 'stop':
      return ctx.running ? { actions: [{ type: 'stop' }], reply: 'Stopping the run.' } : { actions: [{ type: 'stop' }], reply: 'Stopped any reply in progress. No run is active.' };
    case 'resume':
      return ctx.running ? fail('A run is already active.') : { actions: [{ type: 'resume' }], reply: 'Resuming unfinished tasks from the last run.' };
    case 'open': {
      const view = rest.toLowerCase();
      if (!(CHAT_VIEWS as readonly string[]).includes(view)) return fail(`Use /open <${CHAT_VIEWS.join('|')}>.`);
      return { actions: [{ type: 'open', view }] };
    }
    default:
      return fail(`Unknown command /${name}. Type /help.`);
  }
}

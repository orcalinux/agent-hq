import { CHAT_COMMAND_SPECS, CHAT_VIEWS } from '@/utils/chatCompletion';
import type { ApprovalMode, CustomChatCommand, OrchestratorMode, TeamStrategy } from '@/types';

export const RESERVED_CHAT_COMMANDS = new Set([...CHAT_COMMAND_SPECS.map((spec) => spec.name), 'remember']);
const CUSTOM_COMMAND_SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_TEMPLATE_CHARS = 4000;

export function normalizeCommandName(raw: string): string {
  return raw.trim().replace(/^\/+/, '').toLowerCase();
}

export function validateCustomCommandInput(
  input: { name: string; description?: string; template: string; mode?: OrchestratorMode },
  existing: CustomChatCommand[],
  editingId?: string,
): { ok: true; value: Omit<CustomChatCommand, 'id'> } | { ok: false; field: 'name' | 'template'; error: string } {
  const name = normalizeCommandName(input.name);
  if (!name || !CUSTOM_COMMAND_SLUG.test(name)) {
    return {
      ok: false,
      field: 'name',
      error: 'Start with a lowercase letter and use only lowercase letters, numbers, or hyphens (up to 32 characters).',
    };
  }
  if (RESERVED_CHAT_COMMANDS.has(name)) {
    return { ok: false, field: 'name', error: `/${name} is a built-in command and cannot be overridden.` };
  }
  if (existing.some((cmd) => cmd.name === name && cmd.id !== editingId)) {
    return { ok: false, field: 'name', error: `A custom command named /${name} already exists.` };
  }
  const trimmedTemplate = input.template.trim();
  if (!trimmedTemplate) {
    return { ok: false, field: 'template', error: 'Enter a prompt template for this command.' };
  }
  if (input.template.length > MAX_TEMPLATE_CHARS) {
    return { ok: false, field: 'template', error: 'Keep the prompt template under 4,000 characters.' };
  }
  const description = (input.description ?? '').trim().slice(0, 160);
  const mode = input.mode && (input.mode === 'ask' || input.mode === 'plan' || input.mode === 'build') ? input.mode : undefined;
  return {
    ok: true,
    value: {
      name,
      description,
      template: trimmedTemplate,
      ...(mode ? { mode } : {}),
    },
  };
}

/** Filters persisted custom commands so reserved, malformed, or duplicate entries cannot shadow built-ins. */
export function normalizeCustomCommands(raw: unknown): CustomChatCommand[] {
  if (!Array.isArray(raw)) return [];
  const valid: CustomChatCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<CustomChatCommand>;
    if (typeof candidate.name !== 'string' || typeof candidate.template !== 'string') continue;
    const check = validateCustomCommandInput(
      {
        name: candidate.name,
        description: typeof candidate.description === 'string' ? candidate.description : '',
        template: candidate.template,
        mode: candidate.mode,
      },
      valid,
    );
    if (!check.ok) continue;
    const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `cmd-${check.value.name}`;
    valid.push({ id, ...check.value });
  }
  return valid;
}

export function parseCommandArgs(rest: string): string[] {
  const args: string[] = [];
  const trimmed = rest.trim();
  if (!trimmed) return args;
  for (const match of trimmed.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    args.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return args;
}

/**
 * Expands `{{input}}`, `$ARGUMENTS`, positional `$1`..`$9`, `{{file}}`, and `{{project}}`
 * in a single pass so user-supplied text containing template markers is never re-interpolated.
 */
export function expandCustomCommandTemplate(
  template: string,
  rest: string,
  vars?: { file?: string; project?: string },
): string {
  const trimmedRest = rest.trim();
  const usesInput = /\{\{\s*input\s*\}\}|\$ARGUMENTS|\$[1-9]\b/i.test(template);
  const args = parseCommandArgs(trimmedRest);
  const expanded = template.replace(
    /\{\{\s*(input|file|project)\s*\}\}|\$ARGUMENTS|\$([1-9])\b/gi,
    (_full, kind?: string, posIndex?: string) => {
      if (posIndex) return args[Number(posIndex) - 1] ?? '';
      const key = kind?.toLowerCase();
      if (key === 'file') return vars?.file ?? '';
      if (key === 'project') return vars?.project ?? '';
      return trimmedRest;
    },
  );
  if (!usesInput && trimmedRest) return `${expanded.trimEnd()}\n\n${trimmedRest}`;
  return expanded;
}

export interface ChatCommandAgent {
  id: string;
  name: string;
  model?: string;
}

export interface ChatCommandContext {
  mode: OrchestratorMode;
  approval: ApprovalMode;
  strategy: TeamStrategy;
  running: boolean;
  sovereignModel: string;
  agents?: Record<string, ChatCommandAgent>;
  availableModels?: Array<{ ref: string; label?: string }>;
  customCommands?: CustomChatCommand[];
  activeFile?: string;
  projectName?: string;
}

export type ChatCommandAction =
  | { type: 'mode'; mode: OrchestratorMode }
  | { type: 'approval'; mode: ApprovalMode }
  | { type: 'strategy'; strategy: TeamStrategy }
  | { type: 'model'; agentId: string; model: string }
  | { type: 'btw'; prompt: string }
  | { type: 'consult'; agentId: string; prompt: string }
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

function findMentionedAgent(mention: string, agents: Record<string, ChatCommandAgent> | undefined): ChatCommandAgent | undefined {
  if (!agents) return undefined;
  const wanted = mention.toLowerCase();
  return Object.values(agents).find((a) => a.name.toLowerCase() === wanted || a.id.toLowerCase() === wanted);
}

function resolveModelInput(
  query: string,
  availableModels: Array<{ ref: string; label?: string }> | undefined,
): { ref: string } | { error: string } {
  if (!availableModels?.length) return { ref: query };
  const q = query.toLowerCase();
  const exactRef = availableModels.find((m) => m.ref.toLowerCase() === q);
  if (exactRef) return { ref: exactRef.ref };
  const exactLabel = availableModels.filter((m) => (m.label ?? '').toLowerCase() === q || m.ref.toLowerCase().endsWith(`:${q}`));
  if (exactLabel.length === 1) return { ref: exactLabel[0].ref };
  const matches = exactLabel.length > 1
    ? exactLabel
    : availableModels.filter((m) => m.ref.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q));
  if (matches.length === 1) return { ref: matches[0].ref };
  if (matches.length > 1) return { error: `Multiple models match "${query}": ${matches.slice(0, 5).map((m) => m.ref).join(', ')}. Specify the full ref.` };
  return { error: `No connected model matches "${query}". Use /open connections to inspect available models.` };
}

export interface MentionableTask {
  id: string;
  title: string;
  status: string;
  description?: string;
  assignedAgentId?: string;
  agentName?: string;
  error?: string;
  qaFeedback?: string;
}

/** Expands #taskId tokens in a prompt with concise structured summaries from the active mission's tasks. */
export function expandTaskMentions(text: string, tasks: MentionableTask[]): string {
  if (!tasks.length) return text;
  const byId = new Map(tasks.map((t) => [t.id.toLowerCase(), t]));
  const matched: MentionableTask[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([A-Za-z0-9_-]+)/g)) {
    const task = byId.get(m[1].toLowerCase());
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      matched.push(task);
    }
  }
  if (!matched.length) return text;
  const lines = matched.map((t) => {
    const owner = t.agentName || t.assignedAgentId;
    const parts = [`- #${t.id} "${t.title}" [${t.status}${owner ? ` · ${owner}` : ''}]`];
    if (t.description) parts.push(`  Description: ${t.description.slice(0, 300)}`);
    if (t.qaFeedback) parts.push(`  QA feedback: ${t.qaFeedback.slice(0, 300)}`);
    if (t.error) parts.push(`  Error: ${t.error.slice(0, 300)}`);
    return parts.join('\n');
  });
  return `${text}\n\nReferenced tasks:\n${lines.join('\n')}`;
}

/** Splits "/name rest". Returns null for plain text and for /remember, which has its own parser. */
export function parseChatCommand(text: string, customCommands?: CustomChatCommand[]): { name: string; rest: string } | null {
  const match = /^\/([a-z][a-z0-9-]*)(?=$|\s)[ \t]*([\s\S]*)$/iu.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name === 'remember') return null;
  const knownBuiltIn = CHAT_COMMAND_SPECS.some((spec) => spec.name === name);
  const knownCustom = customCommands?.some((cmd) => cmd.name === name) ?? false;
  if (!knownBuiltIn && !knownCustom) return null;
  return { name, rest: match[2].trim() };
}

export function helpText(customCommands?: CustomChatCommand[]): string {
  const lines = CHAT_COMMAND_SPECS.filter((spec) => !spec.aliasOf).map((spec) => {
    const args = spec.args ? ` <${spec.args.map((arg) => arg.value).join('|')}>` : spec.acceptsText ? ' [text]' : '';
    return `/${spec.name}${args} · ${spec.detail}`;
  });
  const base = `Chat commands. Type / to pick one; Tab completes. Type @ to mention an agent and # to cite a task.\n\n${lines.join('\n')}`;
  if (!customCommands?.length) return base;
  const customLines = customCommands.map((cmd) => {
    const modeTag = cmd.mode ? ` (${cmd.mode})` : '';
    return `/${cmd.name} [input] · ${cmd.description || 'Custom prompt template'}${modeTag}`;
  });
  return `${base}\n\nCustom commands:\n${customLines.join('\n')}`;
}

export function interpretChatCommand(command: { name: string; rest: string }, ctx: ChatCommandContext): ChatCommandResult {
  const { name, rest } = command;
  const fail = (error: string): ChatCommandResult => ({ actions: [], error });
  switch (name) {
    case 'help':
      return { actions: [], reply: helpText(ctx.customCommands) };
    case 'status':
      return {
        actions: [],
        reply: `Mode: ${MODE_LABEL[ctx.mode]} · Approval: ${ctx.approval} · Team: ${ctx.strategy} · Sovereign model: ${ctx.sovereignModel || 'not set'} · Run: ${ctx.running ? 'running' : 'idle'}`,
      };
    case 'model': {
      let agentId = 'agent-manager';
      let agentName = 'Sovereign';
      let currentModel = ctx.sovereignModel;
      let query = rest;
      const mention = /^@(\S+)\s*([\s\S]*)$/u.exec(rest);
      if (mention) {
        if (!ctx.agents) return fail('Agent lookup is unavailable.');
        const agent = findMentionedAgent(mention[1], ctx.agents);
        if (!agent) return fail(`No agent is called ${mention[1]}.`);
        agentId = agent.id;
        agentName = agent.name;
        currentModel = agent.model ?? '';
        query = mention[2].trim();
      }
      if (!query) {
        return {
          actions: [],
          reply: `${agentName} model: ${currentModel || (agentId === 'agent-manager' ? 'not set' : 'role default')}. Use /model <ref> or /model @Agent <ref> to change it.`,
        };
      }
      const resolved = resolveModelInput(query, ctx.availableModels);
      if ('error' in resolved) return fail(resolved.error);
      return {
        actions: [{ type: 'model', agentId, model: resolved.ref }],
        reply: `Model for ${agentName} set to ${resolved.ref}.`,
      };
    }
    case 'btw':
      if (!rest) return fail('Write a side question after /btw, for example: /btw what port does the server use?');
      return { actions: [{ type: 'btw', prompt: rest }] };
    case 'consult': {
      const mention = /^@(\S+)\s*([\s\S]*)$/u.exec(rest);
      if (!mention) return fail('Name an agent to consult, for example: /consult @Sentinel is error handling consistent?');
      const question = mention[2].trim();
      if (!question) return fail(`Write a question for @${mention[1]}, for example: /consult @${mention[1]} should this be split?`);
      if (!ctx.agents) return fail('Agent lookup is unavailable.');
      const agent = findMentionedAgent(mention[1], ctx.agents);
      if (!agent) return fail(`No agent is called ${mention[1]}.`);
      return { actions: [{ type: 'consult', agentId: agent.id, prompt: question }] };
    }
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
    default: {
      const custom = ctx.customCommands?.find((cmd) => cmd.name === name);
      if (custom) {
        const expanded = expandCustomCommandTemplate(custom.template, rest, {
          file: ctx.activeFile,
          project: ctx.projectName,
        }).trim();
        if (!expanded) return fail(`Custom command /${name} produced an empty prompt.`);
        return {
          actions: custom.mode ? [{ type: 'mode', mode: custom.mode }] : [],
          prompt: expanded,
        };
      }
      return fail(`Unknown command /${name}. Type /help.`);
    }
  }
}

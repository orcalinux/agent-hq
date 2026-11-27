export interface CompletionAgent {
  id: string;
  name: string;
  title: string;
}

export interface CompletionTask {
  id: string;
  title: string;
  status?: string;
}

export interface CompletionModel {
  ref: string;
  label: string;
  providerName?: string;
}

export interface ChatSuggestion {
  id: string;
  label: string;
  detail: string;
  insert: string;
  hasArgs?: boolean;
}

export interface CompletionToken {
  kind: 'command' | 'agent' | 'task' | 'argument';
  start: number;
  end: number;
  query: string;
  command?: string;
}

export const CHAT_VIEWS = ['workspace', 'agents', 'tasks', 'reports', 'growth', 'connections', 'settings'] as const;

export interface ChatCommandSpec {
  name: string;
  detail: string;
  aliasOf?: string;
  args?: Array<{ value: string; detail: string }>;
  acceptsText?: boolean;
}

export const CHAT_COMMAND_SPECS: ChatCommandSpec[] = [
  { name: 'help', detail: 'List every chat command.' },
  { name: 'status', detail: 'Show mode, approval, team strategy, model and run state.' },
  { name: 'model', detail: "Show or switch Sovereign's model, or @agent's model.", acceptsText: true },
  { name: 'btw', detail: 'Ask a quick side question without altering chat history.', acceptsText: true },
  { name: 'consult', detail: 'Ask a specific team agent (@Agent question) directly.', acceptsText: true },
  { name: 'clear', detail: 'Clear this conversation.' },
  { name: 'new', detail: 'Start a fresh conversation (same as /clear).', aliasOf: 'clear' },
  { name: 'ask', detail: 'Switch to Ask mode, or add text to send it in Ask mode.', acceptsText: true },
  { name: 'plan', detail: 'Switch to Plan mode, or add text to send it in Plan mode.', acceptsText: true },
  { name: 'build', detail: 'Switch to Build mode, or add text to send it in Build mode.', acceptsText: true },
  {
    name: 'approval',
    detail: 'Make approvals stricter. Loosening them needs the approval picker.',
    args: [
      { value: 'ask', detail: 'Ask before every change.' },
      { value: 'auto', detail: 'Approve routine changes.' },
      { value: 'full', detail: 'Full access (use the picker to confirm).' },
    ],
  },
  {
    name: 'team',
    detail: 'Choose how Sovereign builds the team.',
    args: [
      { value: 'adaptive', detail: 'Sovereign adds agents the work needs.' },
      { value: 'fixed', detail: 'Use only the current roster.' },
    ],
  },
  { name: 'stop', detail: 'Stop the current run or reply.' },
  { name: 'resume', detail: 'Resume the last run from its unfinished tasks.' },
  { name: 'open', detail: 'Open a view.', args: CHAT_VIEWS.map((view) => ({ value: view, detail: `Open ${view}.` })) },
  { name: 'remember', detail: 'Save a lesson for the team, or add @agent to teach one agent.', acceptsText: true },
];

export const CHAT_COMMANDS: ChatSuggestion[] = CHAT_COMMAND_SPECS.map((spec) => ({
  id: spec.name,
  label: `/${spec.name}`,
  detail: spec.detail,
  insert: `/${spec.name}`,
  hasArgs: Boolean(spec.args),
}));

export function completionToken(text: string, cursor: number, selectionEnd = cursor): CompletionToken | null {
  if (cursor !== selectionEnd || cursor < 0 || cursor > text.length) return null;
  const prefix = text.slice(0, cursor);
  const argument = /^\s*\/([a-z]+)[ \t]+([^\s/@#]*)$/iu.exec(prefix);
  if (argument && CHAT_COMMAND_SPECS.some((spec) => spec.name === argument[1].toLowerCase() && spec.args)) {
    const suffix = /^[^\s/@#]*/u.exec(text.slice(cursor))![0];
    return { kind: 'argument', command: argument[1].toLowerCase(), start: cursor - argument[2].length, end: cursor + suffix.length, query: argument[2] };
  }
  const modelArg = /^\s*\/model[ \t]+(?:@\S+[ \t]+)?([^\s/@#]*)$/iu.exec(prefix);
  if (modelArg) {
    const suffix = /^[^\s/@#]*/u.exec(text.slice(cursor))![0];
    return { kind: 'argument', command: 'model', start: cursor - modelArg[1].length, end: cursor + suffix.length, query: modelArg[1] };
  }
  const match = /(?:^|\s)([/@#])([^\s/@#]*)$/u.exec(prefix);
  if (!match) return null;
  const start = cursor - match[2].length - 1;
  if (match[1] === '/' && text.slice(0, start).trim()) return null;
  const suffix = /^[^\s/@#]*/u.exec(text.slice(cursor))![0];
  const kind = match[1] === '/' ? 'command' : match[1] === '#' ? 'task' : 'agent';
  return { kind, start, end: cursor + suffix.length, query: match[2] };
}

export function chatSuggestions(
  token: CompletionToken,
  agents: CompletionAgent[],
  options?: { tasks?: CompletionTask[]; models?: CompletionModel[] },
): ChatSuggestion[] {
  const query = token.query.toLocaleLowerCase();
  if (token.kind === 'command') return CHAT_COMMANDS.filter((item) => item.label.slice(1).startsWith(query));
  if (token.kind === 'argument') {
    if (token.command === 'model') {
      return (options?.models ?? [])
        .filter((m) => [m.ref, m.label, m.providerName ?? ''].some((v) => v.toLocaleLowerCase().includes(query)))
        .slice(0, 20)
        .map((m) => ({
          id: `model-${m.ref}`,
          label: m.label,
          detail: m.providerName ? `${m.providerName} · ${m.ref}` : m.ref,
          insert: m.ref,
        }));
    }
    const spec = CHAT_COMMAND_SPECS.find((item) => item.name === token.command);
    return (spec?.args ?? [])
      .filter((arg) => arg.value.startsWith(query))
      .map((arg) => ({ id: `${token.command}-${arg.value}`, label: arg.value, detail: arg.detail, insert: arg.value }));
  }
  if (token.kind === 'task') {
    return (options?.tasks ?? [])
      .filter((task) => [task.id, task.title, task.status ?? ''].some((v) => v.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(b.id.toLocaleLowerCase().startsWith(query)) - Number(a.id.toLocaleLowerCase().startsWith(query)) || a.id.localeCompare(b.id))
      .map((task) => ({
        id: `task-${task.id}`,
        label: `#${task.id}`,
        detail: task.status ? `${task.title} · ${task.status}` : task.title,
        insert: `#${task.id}`,
      }));
  }
  return agents
    .filter((agent) => [agent.name, agent.title, agent.id].some((text) => text.toLocaleLowerCase().includes(query)))
    .sort((first, second) => {
      const firstPrefix = first.name.toLocaleLowerCase().startsWith(query);
      const secondPrefix = second.name.toLocaleLowerCase().startsWith(query);
      return Number(secondPrefix) - Number(firstPrefix) || first.name.localeCompare(second.name) || first.id.localeCompare(second.id);
    })
    .map((agent) => {
      const mention = /\s/u.test(agent.name) || agents.some((other) => other.id !== agent.id && other.name.toLocaleLowerCase() === agent.name.toLocaleLowerCase())
        ? agent.id
        : agent.name;
      return {
        id: agent.id,
        label: `@${agent.name}`,
        detail: `${agent.title}${mention !== agent.name ? ` · @${mention}` : ''}`,
        insert: `@${mention}`,
      };
    });
}

export function applyCompletion(text: string, token: CompletionToken, suggestion: ChatSuggestion): { text: string; cursor: number } {
  const suffix = text.slice(token.end);
  const space = /^\s/u.test(suffix) ? '' : ' ';
  const inserted = `${suggestion.insert}${space}`;
  return { text: text.slice(0, token.start) + inserted + suffix, cursor: token.start + inserted.length + (space ? 0 : 1) };
}

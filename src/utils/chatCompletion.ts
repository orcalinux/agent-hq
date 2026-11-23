export interface CompletionAgent {
  id: string;
  name: string;
  title: string;
}

export interface ChatSuggestion {
  id: string;
  label: string;
  detail: string;
  insert: string;
}

export interface CompletionToken {
  kind: 'command' | 'agent';
  start: number;
  end: number;
  query: string;
}

export const CHAT_COMMANDS: ChatSuggestion[] = [
  {
    id: 'remember',
    label: '/remember',
    detail: 'Save a lesson for the team, or add @agent to teach one agent.',
    insert: '/remember',
  },
];

export function completionToken(text: string, cursor: number, selectionEnd = cursor): CompletionToken | null {
  if (cursor !== selectionEnd || cursor < 0 || cursor > text.length) return null;
  const prefix = text.slice(0, cursor);
  const match = /(?:^|\s)([/@])([^\s/@]*)$/u.exec(prefix);
  if (!match) return null;
  const start = cursor - match[2].length - 1;
  if (match[1] === '/' && text.slice(0, start).trim()) return null;
  const suffix = /^[^\s/@]*/u.exec(text.slice(cursor))![0];
  return { kind: match[1] === '/' ? 'command' : 'agent', start, end: cursor + suffix.length, query: match[2] };
}

export function chatSuggestions(token: CompletionToken, agents: CompletionAgent[]): ChatSuggestion[] {
  const query = token.query.toLocaleLowerCase();
  if (token.kind === 'command') return CHAT_COMMANDS.filter((item) => item.label.slice(1).startsWith(query));
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

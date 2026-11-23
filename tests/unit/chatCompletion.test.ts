import { describe, expect, it } from 'vitest';
import { applyCompletion, chatSuggestions, completionToken } from '@/utils/chatCompletion';
import { parseRemember } from '@/engine/memory';
import type { AgentProfile } from '@/types';

const agents = [
  { id: 'agent-manager', name: 'Sovereign', title: 'Orchestrator' },
  { id: 'agent-frontend', name: 'Pulse', title: 'Frontend engineer' },
  { id: 'agent-custom', name: 'Data Lead', title: 'Data specialist' },
  { id: 'agent-arabic', name: 'نور', title: 'Security engineer' },
];

describe('chat completion', () => {
  it('recognises commands only at the start and mentions at word boundaries', () => {
    expect(completionToken('/', 1)).toMatchObject({ kind: 'command', query: '' });
    expect(completionToken('  /Rem', 6)).toMatchObject({ kind: 'command', query: 'Rem' });
    expect(completionToken('Please ask @Pu', 14)).toMatchObject({ kind: 'agent', start: 11, end: 14, query: 'Pu' });
    expect(completionToken('/remember\n@', 11)).toMatchObject({ kind: 'agent', query: '' });
    for (const text of ['name@company.com', 'src/main.ts', 'read /tmp', 'https://example.com', '`@Pulse', 'hello']) {
      expect(completionToken(text, text.length)).toBeNull();
    }
  });

  it('does not complete selected text or an invalid cursor', () => {
    expect(completionToken('@Pulse', 1, 6)).toBeNull();
    expect(completionToken('@Pulse', -1)).toBeNull();
    expect(completionToken('@Pulse', 7)).toBeNull();
  });

  it('filters supported commands and current agents by name, title and id', () => {
    expect(chatSuggestions(completionToken('/rem', 4)!, agents).map((item) => item.insert)).toEqual(['/remember']);
    expect(chatSuggestions(completionToken('/missing', 8)!, agents)).toEqual([]);
    for (const query of ['pU', 'frontend', 'agent-frontend']) {
      expect(chatSuggestions(completionToken(`@${query}`, query.length + 1)!, agents).map((item) => item.insert)).toEqual(['@Pulse']);
    }
    expect(chatSuggestions(completionToken('@نو', 3)!, agents)[0].insert).toBe('@نور');
    expect(chatSuggestions(completionToken('@', 1)!, agents)).toHaveLength(agents.length);
  });

  it('replaces the entire token under the cursor and preserves the rest of the draft', () => {
    const text = '/remember @Pulse keep buttons accessible';
    const token = completionToken(text, 13)!;
    const suggestion = chatSuggestions(token, agents)[0];
    expect(applyCompletion(text, token, suggestion)).toEqual({ text, cursor: 17 });
    const command = completionToken('/rem', 4)!;
    expect(applyCompletion('/rem', command, chatSuggestions(command, agents)[0])).toEqual({ text: '/remember ', cursor: 10 });
  });

  it('inserts a parser-compatible reference for multiword names and duplicate names', () => {
    const roster = [...agents, { id: 'pulse-twin', name: 'Pulse', title: 'Backend engineer' }];
    const profiles = Object.fromEntries(roster.map((agent) => [agent.id, agent as AgentProfile]));
    const token = completionToken('@', 1)!;
    for (const suggestion of chatSuggestions(token, roster)) {
      const draft = applyCompletion('@', token, suggestion).text;
      expect(parseRemember(`/remember ${draft}Use shared buttons`, profiles)).toEqual({
        agentId: suggestion.id,
        text: 'Use shared buttons',
      });
    }
  });
});

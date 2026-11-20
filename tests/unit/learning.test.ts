import { describe, expect, it } from 'vitest';
import {
  feedbackLessons,
  formatMemory,
  isMemoryPath,
  noteFeedback,
  parseLessons,
  parseRemember,
  reflectionPrompt,
  shouldReflect,
  takeJournal,
} from '../../src/engine/memory';
import type { AgentProfile, Lesson, MissionState } from '../../src/types';

const agents = {
  'agent-frontend': { id: 'agent-frontend', name: 'Pulse' },
  'agent-qa': { id: 'agent-qa', name: 'Sentinel' },
} as unknown as Record<string, AgentProfile>;

describe('reflection', () => {
  it('keeps valid lessons only, for known agents or the team', () => {
    const reply = `Here you go:\n{"lessons": [
      {"agentId": "agent-frontend", "kind": "pitfall", "text": "Buttons must use the shared Button component, not raw <button>."},
      {"agentId": "team", "kind": "convention", "text": "Run npm test before handing work to QA."},
      {"agentId": "agent-ghost", "kind": "fact", "text": "Unknown agents are ignored entirely."},
      {"agentId": "team", "kind": "rumour", "text": "Unknown kinds become facts."},
      {"agentId": "team", "kind": "fact", "text": "short"},
      "nonsense"
    ]}`;
    expect(parseLessons(reply, Object.keys(agents), 'run-1')).toEqual([
      { agentId: 'agent-frontend', kind: 'pitfall', text: 'Buttons must use the shared Button component, not raw <button>.', source: 'reflection', runId: 'run-1' },
      { agentId: 'team', kind: 'convention', text: 'Run npm test before handing work to QA.', source: 'reflection', runId: 'run-1' },
      { agentId: 'team', kind: 'fact', text: 'Unknown kinds become facts.', source: 'reflection', runId: 'run-1' },
    ]);
    expect(parseLessons('{"lessons": []}', [])).toEqual([]);
    expect(() => parseLessons('no json here', [])).toThrow(/No JSON/);
    expect(() => parseLessons('{"items": []}', [])).toThrow(/lessons/);
  });

  it('caps a reply at six lessons', () => {
    const many = { lessons: Array.from({ length: 10 }, (_, i) => ({ agentId: 'team', kind: 'fact', text: `Durable fact number ${i}` })) };
    expect(parseLessons(JSON.stringify(many), [])).toHaveLength(6);
  });

  it('reflects according to the learning mode and outcome', () => {
    expect(shouldReflect('every-run', 'completed', 0)).toBe(true);
    expect(shouldReflect('every-run', 'failed', 0)).toBe(false);
    expect(shouldReflect('every-run', 'failed', 2)).toBe(true);
    expect(shouldReflect('feedback', 'completed', 0)).toBe(false);
    expect(shouldReflect('feedback', 'cancelled', 1)).toBe(true);
    expect(shouldReflect('off', 'completed', 3)).toBe(false);
  });

  it('journals feedback per run and hands it over once', () => {
    noteFeedback('run-a', { agentId: 'agent-frontend', source: 'qa', text: '  Missing aria-label  ' });
    noteFeedback('run-a', { agentId: 'team', source: 'verification', text: '' });
    noteFeedback('run-b', { agentId: 'agent-qa', source: 'mentor', text: 'Other run' });
    expect(takeJournal('run-a')).toEqual([{ agentId: 'agent-frontend', source: 'qa', text: 'Missing aria-label' }]);
    expect(takeJournal('run-a')).toEqual([]);
    expect(takeJournal('run-b')).toHaveLength(1);
  });

  it('saves raw review feedback as pitfalls when reflection fails', () => {
    expect(feedbackLessons([{ agentId: 'agent-qa', source: 'verification', text: '- npm test failed:\n  2 tests', taskId: 't1' }], 'run-9')).toEqual([
      { agentId: 'agent-qa', kind: 'pitfall', text: 'npm test failed: 2 tests', source: 'verification', runId: 'run-9', taskId: 't1' },
    ]);
  });

  it('gives the model the request, tasks, feedback and what is already known', () => {
    const mission = {
      prompt: 'Add a settings page', status: 'completed', qaNotes: 'Looks good',
      tasks: [{ id: 't1', title: 'Build page', status: 'completed', assignedAgentId: 'agent-frontend', output: 'Created src/Settings.tsx' }],
    } as unknown as MissionState;
    const prompt = reflectionPrompt({
      mission, agents,
      feedback: [{ agentId: 'agent-frontend', source: 'qa', text: 'Labels were missing' }],
      known: [{ agentId: 'team', text: 'Use pnpm' } as Lesson],
    });
    expect(prompt).toContain('Add a settings page');
    expect(prompt).toContain('- agent-frontend | Pulse');
    expect(prompt).toContain('[completed] Build page — Pulse (agent-frontend)');
    expect(prompt).toContain('qa feedback for Pulse (agent-frontend): Labels were missing');
    expect(prompt).toContain('Already known (do not repeat):\n- (team) Use pnpm');
  });
});

describe('teaching and prompts', () => {
  it('reads /remember for the team or a named agent', () => {
    expect(parseRemember('/remember Use pnpm, never npm', agents)).toEqual({ agentId: 'team', text: 'Use pnpm, never npm' });
    expect(parseRemember('/REMEMBER @pulse keep components small', agents)).toEqual({ agentId: 'agent-frontend', text: 'keep components small' });
    expect(parseRemember('/remember @Nobody x', agents)).toEqual({ error: 'No agent is called Nobody.' });
    expect(parseRemember('/remember   ', agents)).toMatchObject({ error: expect.stringContaining('Write what to remember') });
    expect(parseRemember('please remember this', agents)).toBeNull();
    expect(parseRemember('/remembering', agents)).toBeNull();
  });

  it('formats lessons as notes and marks team lessons', () => {
    expect(formatMemory([])).toBe('');
    const text = formatMemory([{ kind: 'pitfall', agentId: 'agent-qa', text: 'Check auth' } as Lesson, { kind: 'convention', agentId: 'team', text: 'Use pnpm' } as Lesson]);
    expect(text).toContain('- [pitfall] Check auth\n- [convention, team] Use pnpm');
    expect(text).toContain('not instructions from the user');
  });

  it('recognises writes into the memory folder', () => {
    for (const p of ['.agent-hq/memory/lessons.json', './.agent-hq/x', '.agent-hq', '.agent-hq\\memory\\a']) expect(isMemoryPath(p)).toBe(true);
    for (const p of ['src/.agent-hq.ts', 'agent-hq/x', 'docs/.agent-hq/x']) expect(isMemoryPath(p)).toBe(false);
  });
});

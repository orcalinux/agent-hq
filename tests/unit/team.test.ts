import { describe, expect, it } from 'vitest';
import { juniorsOf, mentorCandidates, pickModel, suggestMentor } from '../../src/engine/team';
import { parsePlan } from '../../src/engine/orchestratorParsing';
import { DEFAULT_AGENTS } from '../../src/store/defaultState';
import { useAgentStore } from '../../src/store/useAgentStore';
import type { AgentProfile, AgentRole } from '../../src/types';

const agents: Record<string, AgentProfile> = DEFAULT_AGENTS;
const defaults = { manager: 'a:strong', architect: '', frontend: 'a:fast', backend: '', qa: '', intern: 'a:cheap' } as Record<AgentRole, string>;

describe('mentors', () => {
  it('lists seniors first and Sovereign as the direct manager, never juniors', () => {
    const ids = mentorCandidates(agents).map((a) => a.id);
    expect(ids.at(-1)).toBe('agent-manager');
    expect(ids).toContain('agent-frontend');
    expect(ids.some((id) => agents[id].internship?.isIntern)).toBe(false);
  });

  it('suggests a senior matching the specialty, then the role, then the least loaded', () => {
    expect(suggestMentor(agents, 'Frontend')).toBe('agent-frontend');
    expect(suggestMentor(agents, 'Backend')).toBe('agent-backend');
    expect(suggestMentor(agents, 'QA')).toBe('agent-qa');
    expect(suggestMentor(agents, 'Security review', 'qa')).toBe('agent-qa');
    const withIot = { ...agents, iot: { ...agents['agent-backend'], id: 'iot', name: 'Volt', specialty: 'IoT & Embedded firmware', title: 'Firmware engineer' } };
    expect(suggestMentor(withIot, 'Embedded firmware', 'backend')).toBe('iot');
    expect(suggestMentor(agents, 'Frontend', undefined, 'agent-frontend')).not.toBe('agent-frontend');
    expect(suggestMentor({ 'agent-manager': agents['agent-manager'] }, 'Frontend')).toBe('agent-manager');
  });

  it('finds the juniors who report to a senior', () => {
    const juniors = Object.values(agents).filter((a) => a.internship?.isIntern);
    expect(juniors.length).toBeGreaterThan(0);
    for (const j of juniors) expect(juniorsOf(agents, j.internship!.mentorId).map((a) => a.id)).toContain(j.id);
  });
});

describe('model for new agents', () => {
  it('always picks an exact available model', () => {
    const available = ['a:strong', 'a:fast', 'a:cheap'];
    expect(pickModel('a:fast', 'backend', defaults, 'a:strong', available)).toBe('a:fast');
    expect(pickModel('gone:model', 'frontend', defaults, 'a:strong', available)).toBe('a:fast');
    expect(pickModel(undefined, 'backend', defaults, 'a:strong', available)).toBe('a:strong');
    expect(pickModel(undefined, 'backend', defaults, '', ['x:only'])).toBe('x:only');
    expect(pickModel(undefined, 'backend', defaults, '', [])).toBe('');
  });
});

describe('team plans', () => {
  it('has no cap on new agents or tasks', () => {
    const newAgents = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, name: `Spec${i}`, role: 'backend', title: 'Specialist' }));
    const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, agentId: `s${i % 9}`, dependsOn: [] }));
    const plan = parsePlan(JSON.stringify({ summary: 's', newAgents, tasks }), agents);
    expect(plan.newAgents).toHaveLength(9);
    expect(plan.tasks).toHaveLength(30);
  });

  it('reads juniors and resolves their mentor to a roster agent or a new senior, keeping that senior', () => {
    const plan = parsePlan(JSON.stringify({
      summary: 's',
      newAgents: [
        { key: 'iot', name: 'Volt', role: 'backend', title: 'Firmware lead', specialty: 'IoT' },
        { key: 'iot-jr', name: 'Spark', role: 'backend', title: 'Firmware junior', junior: true, mentor: 'iot' },
        { key: 'ui-jr', name: 'Pixel', role: 'frontend', title: 'UI junior', junior: true, mentor: 'Pulse' },
        { key: 'x-jr', name: 'Echo', role: 'frontend', title: 'Junior', junior: true, mentor: 'Nobody' },
      ],
      tasks: [
        { id: 't1', title: 'Small firmware fix', agentId: 'iot-jr' },
        { id: 't2', title: 'Button copy', agentId: 'ui-jr' },
        { id: 't3', title: 'Other', agentId: 'x-jr' },
      ],
    }), agents);
    const byName = Object.fromEntries((plan.newAgents ?? []).map((n) => [n.name, n]));
    expect(byName.Volt).toBeDefined();
    expect(byName.Volt.junior).toBeUndefined();
    expect(byName.Spark).toMatchObject({ junior: true, mentor: byName.Volt.key });
    expect(byName.Pixel).toMatchObject({ junior: true, mentor: 'agent-frontend' });
    expect(byName.Echo.junior).toBe(true);
    expect(byName.Echo.mentor).toBeUndefined();
  });
});

describe('changing mentors', () => {
  it('moves a junior to another mentor and reassigns juniors when their mentor is removed', () => {
    const store = useAgentStore.getState();
    const junior = Object.values(store.agents).find((a) => a.internship?.isIntern)!;
    const custom = store.addCustomAgent({ name: 'Volt', role: 'backend', title: 'Firmware engineer', department: 'Engineering', roomLocation: 'Dev Bay' });
    store.setMentor(junior.id, custom);
    expect(useAgentStore.getState().agents[junior.id].internship?.mentorId).toBe(custom);
    store.setMentor(junior.id, junior.id);
    store.setMentor(junior.id, 'missing');
    expect(useAgentStore.getState().agents[junior.id].internship?.mentorId).toBe(custom);
    store.removeAgent(custom);
    const after = useAgentStore.getState().agents[junior.id].internship!.mentorId;
    expect(after).not.toBe(custom);
    expect(useAgentStore.getState().agents[after]).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { trayPanelBounds } from '../../electron/trayPosition';
import { makeTraySnapshot } from '../../src/desktop/traySnapshot';
import { DEFAULT_AGENTS } from '../../src/store/defaultState';
import type { MissionState } from '../../src/types';

describe('tray panel placement', () => {
  const workArea = { x: 0, y: 32, width: 1920, height: 1048 };

  it('opens below a top panel and above a bottom taskbar', () => {
    expect(trayPanelBounds({ x: 1600, y: 0, width: 24, height: 24 }, workArea)).toMatchObject({ x: 1392, y: 40 });
    expect(trayPanelBounds({ x: 1600, y: 1080, width: 24, height: 24 }, workArea)).toMatchObject({ x: 1392, y: 472 });
  });

  it('clamps both side edges without losing the panel', () => {
    expect(trayPanelBounds({ x: 0, y: 0, width: 24, height: 24 }, workArea).x).toBe(8);
    expect(trayPanelBounds({ x: 1910, y: 0, width: 24, height: 24 }, workArea).x).toBe(1472);
  });

  it('supports a second monitor with negative coordinates', () => {
    const area = { x: -1280, y: -900, width: 1280, height: 900 };
    const panel = trayPanelBounds({ x: -20, y: -900, width: 20, height: 20 }, area);
    expect(panel.x).toBe(-448);
    expect(panel.y).toBe(-872);
    expect(panel.x + panel.width).toBeLessThanOrEqual(-8);
  });

  it('shrinks to a small display and accepts a pointer when no icon bounds exist', () => {
    const panel = trayPanelBounds({ x: 319, y: 199, width: 0, height: 0 }, { x: 0, y: 0, width: 320, height: 200 });
    expect(panel).toEqual({ x: 8, y: 8, width: 304, height: 184 });
  });
});

describe('tray snapshot', () => {
  it('sums measured usage, labels models and excludes prompts and credentials', () => {
    const agents = structuredClone(DEFAULT_AGENTS);
    const first = Object.values(agents)[0];
    first.systemPrompt = 'private instruction that must not cross into the panel';
    first.tokenUsage = { calls: 2, totalTokens: 150, promptTokens: 100, completionTokens: 50, estimatedCostUSD: 0, unpricedTokens: 150 };
    const snapshot = makeTraySnapshot(
      { agents, activeMission: null, activity: [], themeMode: 'light' },
      { name: 'My project', root: '/code/my-project' }, [], { busy: 0, running: false, label: 'Idle' },
      () => '', () => 'unused',
    );
    expect(snapshot).toMatchObject({ theme: 'light', project: 'My project', totalAgents: 7, mission: null });
    expect(snapshot.usage).toEqual({ calls: 2, totalTokens: 150, estimatedCostUSD: 0, unpricedTokens: 150 });
    expect(snapshot.agents[0].model).toBe('No model assigned');
    expect(JSON.stringify(snapshot)).not.toContain('private instruction');
    expect(snapshot.agents[0]).not.toHaveProperty('systemPrompt');
  });

  it('keeps demo runs labelled and reports progress, review and recent errors', () => {
    const agents = structuredClone(DEFAULT_AGENTS);
    const first = Object.values(agents)[0];
    const mission = {
      title: 'Build a project', source: 'simulation',
      tasks: [{ status: 'completed' }, { status: 'failed' }, { status: 'pending' }],
      proposedChanges: [{ status: 'pending' }, { status: 'applied' }],
    } as MissionState;
    const snapshot = makeTraySnapshot({
      agents, activeMission: mission, themeMode: 'dark',
      activity: [{ id: 'error', kind: 'step_failed', level: 'error', timestamp: 123, agentId: first.id, text: 'x'.repeat(400) }],
    }, { name: '', root: '' }, [], { busy: 1, running: true, label: 'Working' }, () => 'anthropic:test', () => 'Test model');
    expect(snapshot.mission).toEqual({ title: 'Build a project', completed: 1, total: 3, failed: 1, review: 1, source: 'simulation' });
    expect(snapshot.activity[0]).toMatchObject({ agent: first.name, level: 'error', text: 'x'.repeat(300) });
    expect(snapshot.agents.every((agent) => agent.model === 'Test model')).toBe(true);
  });
});

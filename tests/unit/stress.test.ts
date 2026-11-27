import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planNextWave, type SchedulableTask } from '../../src/engine/scheduler';
import { markConflicts, reworkClosure, selectAutoApply } from '../../src/engine/approval';
import { quotaResetAt } from '../../src/engine/failover';
import { parseLessons } from '../../src/engine/memory';
import { layoutGraph } from '../../src/components/agents/graphLayout';
import { parseAllowedCommand, resolveInside } from '../../server/security';
import { addLessons, loadLessons, memoryContext, type Embedder } from '../../server/memory';
import type { ProposedFileChange } from '../../src/types';

const stressConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-stress-cfg-'));
const stressWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-stress-ws-'));
process.env.AGENT_HQ_CONFIG_DIR = stressConfig;
process.env.AGENT_HQ_WORKSPACE = stressWorkspace;

const { createApiMiddleware } = await import('../../server/api');
const { createTerminal, closeAllTerminals, streamTerminal } = await import('../../server/pty');

afterAll(async () => {
  closeAllTerminals();
  await new Promise((r) => setTimeout(r, 150));
  for (const dir of [stressConfig, stressWorkspace]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Windows PowerShell PTY can hold its working directory handle briefly after kill.
    }
  }
});

describe('scheduler & DAG stress', () => {
  it('blocks transitively in one pass regardless of task ordering', () => {
    const reversed: SchedulableTask[] = [
      { id: 'c', title: 'c', status: 'pending', assignedAgentId: 'a3', dependsOn: ['b'] },
      { id: 'b', title: 'b', status: 'pending', assignedAgentId: 'a2', dependsOn: ['a'] },
      { id: 'a', title: 'a', status: 'failed', assignedAgentId: 'a1', dependsOn: [] },
      { id: 'd', title: 'd', status: 'pending', assignedAgentId: 'a4', dependsOn: [] },
    ];
    const wave = planNextWave(reversed, new Set());
    expect(wave.blocked.map((entry) => entry.task.id).sort()).toEqual(['b', 'c']);
    expect(wave.blocked.find((entry) => entry.task.id === 'c')?.dependency.id).toBe('b');
    expect(wave.blocked.find((entry) => entry.task.id === 'b')?.dependency.id).toBe('a');
    expect(wave.start.map((task) => task.id)).toEqual(['d']);
  });

  it('schedules 100-task randomized reversed DAGs under agent and shared-file exclusion', () => {
    const files: Record<string, string[]> = {};
    const tasks: SchedulableTask[] = [];
    for (let i = 0; i < 100; i++) {
      const deps: string[] = [];
      if (i > 0 && i % 4 !== 0) deps.push(`t${i - 1}`);
      if (i >= 5 && i % 3 === 0) deps.push(`t${i - 5}`);
      files[`t${i}`] = [`file-${i % 7}.ts`];
      tasks.push({ id: `t${i}`, title: `T${i}`, status: 'pending', assignedAgentId: `ag-${i % 12}`, dependsOn: deps });
    }
    // Shuffled / reversed order
    const shuffled = [...tasks].reverse();
    shuffled.find((t) => t.id === 't0')!.status = 'failed';
    const first = planNextWave(shuffled, new Set(), 5, (t) => files[t.id]);
    expect(first.blocked.length).toBeGreaterThan(1);
    const blockedSet = new Set(first.blocked.map((b) => b.task.id));
    expect(blockedSet.has('t1')).toBe(true);
    expect(blockedSet.has('t2')).toBe(true);
    expect(blockedSet.has('t6')).toBe(true);
    expect(blockedSet.has('t4')).toBe(false);
    // Invariants on started tasks
    const agentsSeen = new Set<string>();
    const filesSeen = new Set<string>();
    expect(first.start.length).toBeLessThanOrEqual(5);
    for (const started of first.start) {
      expect(agentsSeen.has(started.assignedAgentId)).toBe(false);
      agentsSeen.add(started.assignedAgentId);
      for (const file of files[started.id]) {
        expect(filesSeen.has(file)).toBe(false);
        filesSeen.add(file);
      }
    }
  });
});

describe('approval ancestor graph with cycles', () => {
  it('propagates full transitive ancestry even when tasks contain a cycle', () => {
    // A depends on B and C; B depends on A (cycle {A, B} both transitively depend on C)
    const tasks = [
      { id: 'A', dependsOn: ['B', 'C'] },
      { id: 'B', dependsOn: ['A'] },
      { id: 'C', dependsOn: [] },
    ];
    const change = (taskId: string, path: string): ProposedFileChange => ({
      id: taskId, taskId, agentId: 'agent-frontend', path, content: taskId, status: 'pending',
    });
    const marked = markConflicts([change('B', 'shared.ts'), change('C', 'shared.ts')], tasks);
    expect(marked.every((c) => !c.conflictsWith)).toBe(true);
    expect(reworkClosure([{ id: 'C', dependsOn: [] }], tasks).map((t) => t.id)).toEqual(['A', 'B', 'C']);

    const { apply, superseded, conflicted } = selectAutoApply(
      [change('C', 'x.ts'), change('B', 'x.ts')],
      tasks
    );
    expect(conflicted).toEqual([]);
    expect(apply.map((c) => c.id)).toEqual(['B']);
    expect(superseded.map((c) => c.id)).toEqual(['C']);
  });
});

describe('quotaResetAt adversarial inputs', () => {
  const now = Date.parse('2026-11-26T14:00:00Z');

  it('supports day durations and rejects plain counts, percentages, and months', () => {
    expect(quotaResetAt('resets in 1d 2h', now)).toBe(now + 86_400_000 + 7_200_000);
    expect(quotaResetAt('try again after 2 days', now)).toBe(now + 2 * 86_400_000);
    for (const bogus of [
      '429: try again 2 times',
      'quota resets 5 times daily',
      'rate limit reached, resets at 100%',
      'resets in 5 months',
      'retry after 10mb limit',
    ]) {
      expect(quotaResetAt(bogus, now), bogus).toBeNull();
    }
    expect(quotaResetAt('resets at 14:30 (UTC)', now)).toBe(Date.parse('2026-11-26T14:30:00Z'));
  });
});

describe('reflection JSON with thinking blocks', () => {
  it('strips <think> blocks that contain braces before parsing lessons', () => {
    const reply = '<think>Analyzing {"bad": true} and thoughts</think>\n```json\n{"lessons":[{"agentId":"team","kind":"convention","text":"Use vitest for unit verification."}]}\n```';
    expect(parseLessons(reply, ['agent-frontend'], 'run-x')).toEqual([
      { agentId: 'team', kind: 'convention', text: 'Use vitest for unit verification.', source: 'reflection', runId: 'run-x' },
    ]);
  });
});

describe('security allowlist hardening & fuzzing', () => {
  it('blocks go exec/output flags, cargo output flags, backslash & drive-letter & short-flag escapes', () => {
    const blocked = [
      'go test -exec=sh ./...',
      'go test -exec sh ./...',
      'go test --exec=env ./...',
      'go build -o out.bin ./...',
      'go test -coverprofile=cov.out ./...',
      'go test -vettool=/tmp/evil ./...',
      'cargo test --target-dir /tmp/evil',
      'cargo test --target-dir=out',
      'pytest --basetemp=tmp_out',
      'pytest --junitxml=report.xml',
      'python -m pytest --basetemp=tmp_out',
      'ls ..\\other',
      'ls C:\\Windows\\System32',
      'git status -C/etc',
      'git diff -O/etc/passwd',
      'git status -C../outside',
      'npm test ..\\outside',
    ];
    for (const cmd of blocked) {
      expect(parseAllowedCommand(cmd).ok, cmd).toBe(false);
    }

    const allowed = [
      'go test ./...',
      'go test -v ./pkg',
      'go vet ./...',
      'cargo test --workspace',
      'python -m pytest -q tests/unit',
      'npm run build',
      'npx vitest run',
    ];
    for (const cmd of allowed) {
      expect(parseAllowedCommand(cmd).ok, cmd).toBe(true);
    }
  });

  it('survives 300 adversarial fuzzed command lines without allowing shell escapes', () => {
    const seeds = ['ls', 'git status', 'go test', 'python -m pytest', 'cargo test', 'rm', 'bash'];
    const suffixes = ['', ' ; id', ' | cat', ' $(whoami)', ' /etc/passwd', ' ../secret', ' ..\\secret', ' `id`', ' -exec=sh', ' C:\\x', ' \0a'];
    for (let i = 0; i < 300; i++) {
      const cmd = `${seeds[i % seeds.length]}${suffixes[(i * 7) % suffixes.length]}`;
      const res = parseAllowedCommand(cmd);
      if (res.ok) {
        expect(['ls', 'git', 'go', 'python', 'cargo']).toContain(res.program);
        expect(res.args?.join(' ')).not.toMatch(/[;&|`$<>()\\]|\.\.[/\\]|\0/);
      }
    }
    expect(resolveInside(stressWorkspace, 'a\0b')).toBeNull();
  });
});

describe('graphLayout stress', () => {
  it('lays out up to 40 agents without overlaps across narrow and wide viewports', () => {
    const nodes = [
      { id: 'm', tier: 0 },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, tier: 1 })),
      ...Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, tier: 2 })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `j${i}`, tier: 3 })),
    ];
    for (const [w, h] of [[420, 640], [1024, 768], [1600, 900]]) {
      const layout = layoutGraph(nodes, w, h, {});
      expect(layout.positions.size).toBe(40);
      for (const pos of layout.positions.values()) {
        expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
      }
    }
  });
});

describe('concurrent memoryContext & atomic writes', () => {
  it('handles 20 parallel memoryContext calls alongside concurrent addLessons without temp collisions or lost writes', async () => {
    const memRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-mem-stress-'));
    try {
      addLessons(memRoot, [
        { agentId: 'team', kind: 'convention', text: 'Always run tests before merging changes.', source: 'user' },
        { agentId: 'agent-backend', kind: 'pitfall', text: 'Keep SQL queries parameterized in storage.py.', source: 'qa' },
      ]);
      const slowEmbedder: Embedder = {
        model: 'slow-fake',
        async embed(texts) {
          await new Promise((r) => setTimeout(r, 20));
          return texts.map((t) => [t.includes('SQL') ? 1 : 0.5, 0.2]);
        },
      };

      const contextRuns = Array.from({ length: 20 }, (_, i) =>
        memoryContext(memRoot, { agentId: 'agent-backend', query: `storage query ${i}` }, slowEmbedder)
      );
      await new Promise((r) => setTimeout(r, 5));
      addLessons(memRoot, [
        { agentId: 'agent-frontend', kind: 'decision', text: 'Use accessible button components across dialogs.', source: 'user' },
      ]);
      await Promise.all(contextRuns);

      const finalLessons = loadLessons(memRoot);
      expect(finalLessons).toHaveLength(3);
      const teamLesson = finalLessons.find((l) => l.agentId === 'team')!;
      expect(teamLesson.uses).toBe(20);
    } finally {
      fs.rmSync(memRoot, { recursive: true, force: true });
    }
  });
});

describe('server API JSON & PTY SSE robustness', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const api = createApiMiddleware();
    server = http.createServer((req, res) => {
      void api(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  });

  it('rejects primitive/null/array JSON bodies with 400 instead of crashing with 500', async () => {
    for (const payload of ['null', '123', '[]', '"text"', '{bad json']) {
      const res = await fetch(`${baseUrl}/api/runs/journal`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      expect(res.status, `payload ${payload}`).toBe(400);
    }
  });

  it('does not crash when streamTerminal receives data after client disconnects', async () => {
    const session = await createTerminal({ cwd: stressWorkspace });
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/terminal/stream?id=${session.id}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    ac.abort();
    await new Promise((r) => setTimeout(r, 30));
    closeAllTerminals();
    await new Promise((r) => setTimeout(r, 100));
  });
});

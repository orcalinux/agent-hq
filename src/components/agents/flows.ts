import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { ActiveBeamEvent, ActivityEvent, AgentProfile, KanbanTaskCard } from '@/types';

export type FlowKind = 'delegate' | 'handoff' | 'review' | 'qa' | 'report' | 'error';

export interface AgentFlow {
  id: string;
  from: string;
  to: string;
  kind: FlowKind;
  label: string;
  at: number;
}

export const FLOW_META: Record<FlowKind, { color: string; label: string }> = {
  delegate: { color: 'var(--accent)', label: 'Delegation' },
  handoff: { color: 'var(--tok-type)', label: 'Dependency hand-off' },
  review: { color: 'var(--tok-keyword)', label: 'N+1 review' },
  qa: { color: 'var(--warning)', label: 'QA' },
  report: { color: 'var(--success)', label: 'Result reported' },
  error: { color: 'var(--danger)', label: 'Failure / rejection' },
};

const BEAM_KIND: Record<ActiveBeamEvent['type'], FlowKind> = {
  prompt: 'delegate',
  architecture: 'handoff',
  code_diff: 'report',
  qa_reject: 'error',
  qa_approve: 'qa',
  mentorship: 'review',
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return reduced;
}

function flowsFromActivity(event: ActivityEvent, agents: AgentProfile[], tasks: KanbanTaskCard[]): AgentFlow[] {
  if (!event.agentId) return [];
  const manager = agents.find((a) => a.role === 'manager');
  const task = event.taskId ? tasks.find((t) => t.id === event.taskId) : undefined;
  const base = { label: event.text, at: event.timestamp };
  const out: AgentFlow[] = [];
  const push = (from: string | undefined, to: string | undefined, kind: FlowKind, suffix: string) => {
    if (from && to && from !== to) out.push({ id: event.id + suffix, from, to, kind, ...base });
  };
  switch (event.kind) {
    case 'step_started':
      push(manager?.id, event.agentId, 'delegate', ':d');
      task?.dependsOn?.forEach((depId, i) => {
        const dep = tasks.find((t) => t.id === depId);
        push(dep?.assignedAgentId, event.agentId, 'handoff', ':h' + i);
      });
      break;
    case 'step_completed':
      push(event.agentId, manager?.id, 'report', ':r');
      break;
    case 'step_failed':
      push(event.agentId, manager?.id, 'error', ':e');
      break;
    case 'review':
      push(event.agentId, task?.assignedAgentId, event.level === 'warn' ? 'error' : 'review', ':v');
      break;
    case 'qa':
      push(event.agentId, manager?.id, event.level === 'warn' || event.level === 'error' ? 'error' : 'qa', ':q');
      break;
    default:
      break;
  }
  return out;
}

/** Agent-to-agent message flows derived from real engine activity (and the labelled demo's beam events) within the last `windowMs`. */
export function useAgentFlows(windowMs = 9000): AgentFlow[] {
  const activity = useAgentStore((s) => s.activity);
  const beams = useAgentStore((s) => s.activeBeams);
  const agentsMap = useAgentStore((s) => s.agents);
  const tasks = useAgentStore((s) => s.activeMission?.tasks);
  const [now, setNow] = useState(() => Date.now());

  const latest = Math.max(activity[activity.length - 1]?.timestamp ?? 0, beams[0]?.timestamp ?? 0);
  useEffect(() => {
    setNow(Date.now());
    if (Date.now() - latest > windowMs) return undefined;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - latest > windowMs) window.clearInterval(timer);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [latest, windowMs]);

  return useMemo(() => {
    const agents = Object.values(agentsMap);
    const ids = new Set(agents.map((a) => a.id));
    const out: AgentFlow[] = [];
    for (let i = activity.length - 1; i >= 0; i -= 1) {
      const ev = activity[i];
      if (now - ev.timestamp > windowMs) break;
      out.push(...flowsFromActivity(ev, agents, tasks ?? []));
    }
    beams.forEach((b) => {
      if (now - b.timestamp <= windowMs) out.push({ id: b.id, from: b.fromAgentId, to: b.toAgentId, kind: BEAM_KIND[b.type], label: b.label, at: b.timestamp });
    });
    return out.filter((f) => ids.has(f.from) && ids.has(f.to)).sort((a, b) => b.at - a.at).slice(0, 12);
  }, [activity, beams, agentsMap, tasks, now, windowMs]);
}

/** Most recent activity text per agent within the window, for speech bubbles. */
export function useRecentAgentMessages(windowMs = 9000): Record<string, string> {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const flows = useAgentFlows(windowMs);
  return useMemo(() => {
    const now = Date.now();
    const out: Record<string, string> = {};
    Object.values(agents).forEach((a) => {
      if (a.speechBubble && now - a.speechBubble.timestamp <= windowMs) out[a.id] = a.speechBubble.text;
    });
    for (let i = activity.length - 1; i >= 0; i -= 1) {
      const ev = activity[i];
      if (now - ev.timestamp > windowMs) break;
      if (ev.agentId && !out[ev.agentId]) out[ev.agentId] = ev.text;
    }
    return out;
  }, [activity, agents, flows, windowMs]);
}

/** A gently curved path between two points, bowed to one side so opposite flows don't overlap. */
export function curvePath(x1: number, y1: number, x2: number, y2: number, bow = 0.18): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * bow;
  const cy = my + dx * bow;
  return 'M' + x1 + ',' + y1 + ' Q' + cx + ',' + cy + ' ' + x2 + ',' + y2;
}

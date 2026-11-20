import { useAgentStore } from '@/store/useAgentStore';
import { retryTask } from '@/engine/liveOrchestrator';
import { SidePanel } from '@/components/ui/Dialog';
import { Badge, Button, ProgressBar, Section } from '@/components/ui/primitives';
import { fmtDuration, fmtTokens } from '@/components/ui/helpers';
import { useLayoutStore } from '@/store/useLayoutStore';
import { STATUS_TONE } from './taskUi';

export function TaskDetail({ selectedId, open }: { selectedId: string; open: boolean }) {
  const mission = useAgentStore((s) => s.activeMission);
  const agents = useAgentStore((s) => s.agents);
  const running = useAgentStore((s) => s.isLiveRunning);
  const select = useAgentStore((s) => s.selectTask);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const setView = useAgentStore((s) => s.setActiveView);
  const width = useLayoutStore((s) => s.detailWidth);
  const task = mission?.tasks.find((t) => t.id === selectedId);
  if (!task || !mission) return null;
  const agent = agents[task.assignedAgentId];
  const canRetry = mission.source === 'live' && !running && (task.status === 'failed' || task.status === 'rejected' || task.status === 'cancelled');

  return (
    <SidePanel
      open={open}
      onClose={() => select(null)}
      width={width}
      title={task.title}
      subtitle={<span className="flex min-w-0 items-center gap-1.5 overflow-hidden"><Badge tone={STATUS_TONE[task.status]}>{task.status.replace('_', ' ')}</Badge><Badge>{task.priority}</Badge><Badge>{task.stage}</Badge></span>}
    >
      <div className="space-y-5">
        <p className="whitespace-pre-wrap text-[12.5px] text-fg-muted">{task.description}</p>
        <ProgressBar value={task.progress} tone={task.status === 'failed' ? 'danger' : 'accent'} />

        <Section title="Assignment">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px] [&_dd]:min-w-0 [&_dd]:truncate [&_dt]:whitespace-nowrap">
            <dt className="text-fg-muted">Agent</dt>
            <dd className="text-right">{agent ? <button type="button" className="max-w-full truncate text-accent hover:underline" onClick={() => { selectAgent(agent.id); setView('agents'); }}>{agent.name}</button> : task.assignedAgentId}</dd>
            <dt className="text-fg-muted">Model used</dt><dd className="text-right font-mono text-[12px]">{task.model || '—'}</dd>
            <dt className="text-fg-muted">Depends on</dt><dd className="text-right">{task.dependsOn?.length ? task.dependsOn.join(', ') : 'nothing'}</dd>
            <dt className="text-fg-muted">Attempts</dt><dd className="text-right tabular-nums">{task.attempts ?? 0}</dd>
            <dt className="text-fg-muted">Duration</dt><dd className="text-right tabular-nums">{fmtDuration(task.durationMs ?? 0)}</dd>
            <dt className="text-fg-muted">Tokens</dt><dd className="text-right tabular-nums">{task.tokens ? fmtTokens(task.tokens) : '—'}</dd>
          </dl>
        </Section>

        {task.n1ReviewerId ? (
          <Section title="Senior review (N+1)">
            <p className="text-[12.5px]">Reviewer: {task.n1ReviewerName ?? task.n1ReviewerId} · <Badge tone={task.n1ReviewStatus === 'approved' || task.n1ReviewStatus === 'bug_fixed' ? 'success' : 'warning'}>{task.n1ReviewStatus?.replace('_', ' ')}</Badge></p>
            {task.n1ReviewNote ? <p className="whitespace-pre-wrap text-[12px] text-fg-muted">{task.n1ReviewNote}</p> : null}
          </Section>
        ) : null}

        {task.error ? (
          <Section title="Error"><p className="whitespace-pre-wrap break-words rounded-md border border-danger/30 bg-danger-soft p-2 text-[12px] text-danger">{task.error}</p></Section>
        ) : null}
        {task.waitingReason ? <p className="text-[12px] text-warning">Waiting: {task.waitingReason}</p> : null}
        {task.qaFeedback ? (
          <Section title="QA feedback"><p className="whitespace-pre-wrap rounded-md border border-warning/30 bg-warning-soft p-2 text-[12px]">{task.qaFeedback}</p></Section>
        ) : null}

        <Section title="Output">
          {task.output ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2 p-2 font-mono text-[11.5px]">{task.output}</pre> : <p className="text-[12px] text-fg-subtle">No output yet.</p>}
        </Section>

        {canRetry ? <Button variant="primary" onClick={() => void retryTask(task.id)}>Retry task</Button> : null}
      </div>
    </SidePanel>
  );
}

import { useMemo, useState } from 'react';
import { AlertTriangle, Play, RotateCcw, Square } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { resumeRun, stopRun } from '@/engine/liveOrchestrator';
import { SOP_STAGES, type KanbanTaskCard, type SOPStage } from '@/types';
import { Badge, Button, EmptyState, Input, ProgressBar, Select } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { TaskDetail } from './TaskDetail';
import { PRIORITY_ORDER, STATUS_TONE } from './taskUi';

type SortKey = 'priority' | 'updated' | 'progress';

function TaskCard({ task, selected, onSelect }: { task: KanbanTaskCard; selected: boolean; onSelect: () => void }) {
  const agent = useAgentStore((s) => s.agents[task.assignedAgentId]);
  const problem = task.status === 'rejected' || task.status === 'failed' || Boolean(task.qaFeedback);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-md border bg-surface p-2.5 text-left transition-colors hover:bg-surface-2',
        selected ? 'border-accent' : problem ? 'border-danger/40' : 'border-line'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium leading-snug">{task.title}</span>
        <Badge tone={STATUS_TONE[task.status]}>{task.status.replace('_', ' ')}</Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-muted">
        <span>{agent?.name ?? task.assignedAgentId}</span>
        <Badge tone={task.priority === 'critical' || task.priority === 'high' ? 'warning' : 'neutral'}>{task.priority}</Badge>
        {task.dependsOn?.length ? <span title={'Depends on ' + task.dependsOn.join(', ')}>needs {task.dependsOn.length}</span> : null}
        {task.n1ReviewerId ? <Badge tone={task.n1ReviewStatus === 'approved' || task.n1ReviewStatus === 'bug_fixed' ? 'success' : 'neutral'} title="Senior review required">N+1 {task.n1ReviewStatus?.replace('_', ' ')}</Badge> : null}
      </div>
      {task.status === 'in_progress' || (task.progress > 0 && task.progress < 100) ? <div className="mt-2"><ProgressBar value={task.progress} /></div> : null}
      {task.error ? <p className="mt-1.5 line-clamp-2 flex gap-1 text-[11.5px] text-danger"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{task.error}</p> : null}
      {task.qaFeedback && !task.error ? <p className="mt-1.5 line-clamp-2 text-[11.5px] text-warning">QA: {task.qaFeedback}</p> : null}
      {task.waitingReason ? <p className="mt-1.5 text-[11.5px] text-fg-subtle">Waiting: {task.waitingReason}</p> : null}
    </button>
  );
}

export default function TasksView() {
  const mission = useAgentStore((s) => s.activeMission);
  const agents = useAgentStore((s) => s.agents);
  const selectedTaskId = useAgentStore((s) => s.selectedTaskId);
  const select = useAgentStore((s) => s.selectTask);
  const liveRunning = useAgentStore((s) => s.isLiveRunning);
  const simulating = useAgentStore((s) => s.isSimulating);
  const isPaused = useAgentStore((s) => s.isPaused);
  const presets = useAgentStore((s) => s.missionPresets);
  const launch = useAgentStore((s) => s.launchMission);
  const pauseSim = useAgentStore((s) => s.pauseMission);
  const resumeSim = useAgentStore((s) => s.resumeMission);
  const resetSim = useAgentStore((s) => s.resetMission);
  const setView = useAgentStore((s) => s.setActiveView);
  const [q, setQ] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('priority');
  const [preset, setPreset] = useState('');

  const columns = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const tasks = (mission?.tasks ?? []).filter(
      (t) =>
        (!needle || t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle)) &&
        (!agentFilter || t.assignedAgentId === agentFilter) &&
        (!statusFilter || t.status === statusFilter) &&
        (!priorityFilter || t.priority === priorityFilter)
    );
    const cmp = (a: KanbanTaskCard, b: KanbanTaskCard) =>
      sort === 'priority' ? PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] : sort === 'progress' ? b.progress - a.progress : b.updatedAt - a.updatedAt;
    return SOP_STAGES.map((stage) => ({ stage, tasks: tasks.filter((t) => t.stage === stage.id).sort(cmp) }));
  }, [mission, q, agentFilter, statusFilter, priorityFilter, sort]);

  const isLive = mission?.source === 'live';
  const stageOf = (id: SOPStage) => columns.find((c) => c.stage.id === id);
  const rejected = mission?.tasks.filter((t) => t.status === 'rejected' || t.qaFeedback).length ?? 0;
  const done = mission?.tasks.filter((t) => t.status === 'completed').length ?? 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-1.5">
        <div className="min-w-0">
          <h1 className="text-[14px] font-semibold">Tasks</h1>
          <p className="truncate text-[12px] text-fg-muted">
            {mission ? mission.title + ' · ' + done + '/' + mission.tasks.length + ' done · ' + mission.status : 'No run yet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mission ? <Badge tone={isLive ? 'accent' : 'warning'}>{isLive ? 'Live run' : 'Simulated demo'}</Badge> : null}
          {isLive && liveRunning ? <Button variant="danger" icon={Square} onClick={stopRun}>Stop</Button> : null}
          {isLive && !liveRunning && (mission.status === 'cancelled' || mission.status === 'failed' || mission.status === 'paused') ? <Button icon={RotateCcw} onClick={() => void resumeRun()}>Resume</Button> : null}
          {mission && !isLive && simulating && !isPaused ? <Button onClick={pauseSim}>Pause demo</Button> : null}
          {mission && !isLive && isPaused ? <Button variant="primary" onClick={resumeSim}>Resume demo</Button> : null}
          {mission && !isLive ? <Button onClick={resetSim}>Clear demo</Button> : null}
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="w-48" />
        <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Filter by agent" className="w-36">
          <option value="">All agents</option>
          {Object.values(agents).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="w-36">
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Filter by priority" className="w-32">
          <option value="">All priorities</option>
          {Object.keys(PRIORITY_ORDER).map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort tasks" className="w-36">
          <option value="priority">Sort: priority</option>
          <option value="updated">Sort: recently updated</option>
          <option value="progress">Sort: progress</option>
        </Select>
        {rejected > 0 ? <Badge tone="danger">{rejected} with QA feedback or rejection</Badge> : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {!mission ? (
            <EmptyState
              title="No tasks yet"
              action={
                <div className="flex flex-col items-center gap-3">
                  <Button variant="primary" icon={Play} onClick={() => setView('workspace')}>Ask Sovereign to plan work</Button>
                  <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
                    <span>or try a scripted demo (no models are called):</span>
                    <Select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Demo scenario" className="w-48">
                      <option value="">Choose scenario</option>
                      {presets.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </Select>
                    <Button disabled={!preset || liveRunning} onClick={() => launch(preset)}>Run simulated demo</Button>
                  </div>
                </div>
              }
            >
              Tasks appear here when you approve a plan from the orchestrator chat. Each task moves through Briefing, Architecture, Implementation, Code Review and QA, and Shipped.
            </EmptyState>
          ) : (
            <div className="grid h-full min-w-[1000px] grid-cols-5 gap-3 p-3">
              {SOP_STAGES.map((s) => {
                const col = stageOf(s.id);
                return (
                  <section key={s.id} className="flex min-h-0 flex-col rounded-md bg-surface-2" aria-label={s.shortLabel}>
                    <h2 className="flex items-center justify-between px-2.5 py-2 text-[12px] font-semibold">
                      {s.shortLabel}
                      <span className="rounded bg-surface-3 px-1.5 text-[11px] font-normal text-fg-muted">{col?.tasks.length ?? 0}</span>
                    </h2>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                      {col?.tasks.map((t) => <TaskCard key={t.id} task={t} selected={selectedTaskId === t.id} onSelect={() => select(selectedTaskId === t.id ? null : t.id)} />)}
                      {col?.tasks.length === 0 ? <p className="px-1 py-3 text-center text-[11.5px] text-fg-subtle">No tasks</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
        {selectedTaskId ? <TaskDetail /> : null}
      </div>
    </div>
  );
}

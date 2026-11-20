import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, Paperclip, Square, Trash2, X } from 'lucide-react';
import { useAgentStore, resolveAgentModel } from '@/store/useAgentStore';
import { useConnectionsStore, isModelAvailable } from '@/store/useConnectionsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { approveAndRun, resumeRun, sendToOrchestrator, stopChat, stopRun, updatePlan } from '@/engine/liveOrchestrator';
import { stripThinking } from '@/engine/orchestratorParsing';
import type { ManagerChatMessage, OrchestratorMode, OrchestratorPlan, TeamStrategy } from '@/types';
import { Badge, Button, EmptyState, IconButton, Input, ProgressBar, Select, Tabs } from '@/components/ui/primitives';
import { ModelSelect, fmtTokens, modelLabel } from '@/components/ui/helpers';
import { ApprovalModeSelect } from '@/components/shell/ApprovalMode';
import { Markdown } from './Markdown';

const MODES: Array<{ id: OrchestratorMode; label: string; hint: string }> = [
  { id: 'ask', label: 'Ask', hint: 'Discuss and inspect. Never starts work or changes files.' },
  { id: 'plan', label: 'Plan', hint: 'Sovereign proposes tasks and agents. You review before anything runs.' },
  { id: 'build', label: 'Build', hint: 'Sovereign proposes a plan; approving it runs the agents.' },
];

function PlanCard({ message }: { message: ManagerChatMessage }) {
  const plan = message.plan as OrchestratorPlan;
  const agents = useAgentStore((s) => s.agents);
  const running = useAgentStore((s) => s.isLiveRunning || s.isSimulating);
  const [error, setError] = useState<string | null>(null);
  const editable = plan.status === 'proposed';

  const setAgent = (taskId: string, agentId: string) =>
    updatePlan(message.id, { ...plan, tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, agentId } : t)) });
  const setTaskModel = (taskId: string, model: string) =>
    updatePlan(message.id, { ...plan, tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, model: model || undefined } : t)) });
  const newAgents = plan.newAgents ?? [];
  const setNewAgentModel = (key: string, model: string) =>
    updatePlan(message.id, { ...plan, newAgents: newAgents.map((n) => (n.key === key ? { ...n, model: model || undefined } : n)) });
  const dropNewAgent = (key: string) => {
    const dropped = newAgents.find((n) => n.key === key);
    const fallback = Object.values(agents).find((a) => a.role === dropped?.role && !a.internship?.isIntern)?.id ?? 'agent-manager';
    updatePlan(message.id, {
      ...plan,
      newAgents: newAgents.filter((n) => n.key !== key),
      tasks: plan.tasks.map((t) => (t.agentId === key ? { ...t, agentId: fallback } : t)),
    });
  };
  const removeTask = (taskId: string) =>
    updatePlan(message.id, {
      ...plan,
      tasks: plan.tasks.filter((t) => t.id !== taskId).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== taskId) })),
    });

  const run = async () => {
    setError(null);
    try {
      await approveAndRun(message.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface-2 shadow-card">
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] font-semibold">Proposed plan · {plan.tasks.length} tasks</span>
          <Badge className="shrink-0" tone={plan.status === 'executed' ? 'success' : plan.status === 'discarded' ? 'neutral' : 'accent'}>{plan.status}</Badge>
        </div>
        {plan.summary ? <p className="mt-1 text-[12px] text-fg-muted">{plan.summary}</p> : null}
      </div>
      {newAgents.length ? (
        <div className="border-b border-line bg-accent-soft/40 px-3 py-2">
          <div className="mb-1.5 truncate text-[12px] font-semibold">Sovereign wants to add {newAgents.length === 1 ? 'an agent' : `${newAgents.length} agents`} for this project</div>
          <ul className="space-y-1.5">
            {newAgents.map((n) => (
              <li key={n.key} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[12.5px] font-medium"><span className="min-w-0 truncate">{n.name} <span className="font-normal text-fg-muted">· {n.title}</span></span> <Badge className="shrink-0">{n.role}</Badge></div>
                    {n.reason ? <p className="text-[11.5px] text-fg-muted">{n.reason}</p> : null}
                  </div>
                  {editable ? <IconButton icon={X} label={`Don't add ${n.name}`} size="sm" onClick={() => dropNewAgent(n.key)} /> : null}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] text-fg-subtle">Model</span>
                  <ModelSelect value={n.model ?? ''} onChange={(ref) => setNewAgentModel(n.key, ref)} emptyLabel={`${n.role} default`} disabled={!editable} className="h-6 flex-1" aria-label={`Model for ${n.name}`} />
                </div>
              </li>
            ))}
          </ul>
          {editable ? <p className="mt-1 text-[11px] text-fg-subtle">They are created only if you approve. Remove one to give its tasks to an existing agent.</p> : null}
        </div>
      ) : null}
      <ol className="divide-y divide-line">
        {plan.tasks.map((t, i) => (
          <li key={t.id} className="space-y-1 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 font-mono text-[11px] text-fg-subtle">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{t.title}</div>
                <p className="text-[12px] text-fg-muted">{t.description}</p>
              </div>
              {editable ? <IconButton icon={X} label={`Remove task ${t.title}`} size="sm" onClick={() => removeTask(t.id)} /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-4 text-[11.5px] text-fg-subtle">
              <Badge>{t.stage}</Badge>
              <Badge tone={t.priority === 'critical' || t.priority === 'high' ? 'warning' : 'neutral'}>{t.priority}</Badge>
              {t.dependsOn.length ? <span className="whitespace-nowrap">after {t.dependsOn.join(', ')}</span> : null}
              <Select
                aria-label={`Agent for ${t.title}`}
                value={t.agentId}
                disabled={!editable}
                onChange={(e) => setAgent(t.id, e.target.value)}
                className="ml-auto h-6 w-40"
              >
                {newAgents.length ? (
                  <optgroup label="New for this plan">
                    {newAgents.map((n) => (
                      <option key={n.key} value={n.key}>{n.name} · {n.title}</option>
                    ))}
                  </optgroup>
                ) : null}
                {Object.values(agents).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {a.title}</option>
                ))}
              </Select>
              <ModelSelect value={t.model ?? ''} onChange={(ref) => setTaskModel(t.id, ref)} emptyLabel="Agent's model" disabled={!editable} className="h-6 w-44" aria-label={`Model for ${t.title}`} />
            </div>
          </li>
        ))}
      </ol>
      {editable ? (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 truncate text-[11.5px] text-fg-subtle">{running ? 'Another run is in progress.' : 'Nothing runs until you approve.'}</span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => updatePlan(message.id, { ...plan, status: 'discarded' })}>Discard</Button>
            <Button size="sm" variant="primary" disabled={running || plan.tasks.length === 0} onClick={() => void run()}>{'Approve & run'}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="border-t border-line px-3 py-2 text-[12px] text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

function Message({ message }: { message: ManagerChatMessage }) {
  const providers = useConnectionsStore((s) => s.providers);
  if (message.sender === 'system') {
    return <div className="px-1 text-center text-[11.5px] text-fg-subtle">{message.text}</div>;
  }
  if (message.sender === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/20 bg-accent-soft px-3.5 py-2 text-[13px] shadow-card">
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
          {message.attachedFiles?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.attachedFiles.map((f) => <Badge key={f}>{f}</Badge>)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  const text = stripThinking(message.text);
  const showText = !message.plan || message.planError;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
        <span className="font-semibold text-fg-muted">Sovereign</span>
        {message.mode ? <span>{message.mode}</span> : null}
        {message.model ? <span className="min-w-0 truncate font-mono">{modelLabel(providers, message.model)}</span> : null}
      </div>
      {showText && text ? <Markdown text={text} /> : null}
      {message.streaming && !text ? <p className="text-[12.5px] text-fg-subtle">Thinking…</p> : null}
      {message.planError ? <p className="text-[12px] text-warning">{message.planError}</p> : null}
      {message.error ? <p className="flex items-start gap-1.5 text-[12.5px] text-danger" role="alert"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message.error}</p> : null}
      {message.plan ? <PlanCard message={message} /> : null}
      {!message.streaming && message.usage ? (
        <p className="text-[11px] text-fg-subtle">
          {message.usage.totalTokens !== undefined ? `${fmtTokens(message.usage.totalTokens)} tokens` : null}
          {message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : null}
        </p>
      ) : null}
    </div>
  );
}

function AttachPicker({ onPick }: { onPick: (path: string) => void }) {
  const tree = useWorkspaceStore((s) => s.tree);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tree.filter((f) => f.type === 'file' && (!q || f.path.toLowerCase().includes(q))).slice(0, 8);
  }, [tree, query]);
  return (
    <div className="relative">
      <IconButton icon={Paperclip} label="Attach a project file" active={open} onClick={() => setOpen((o) => !o)} />
      {open ? (
        <div className="absolute bottom-9 left-0 z-20 w-72 rounded-xl border border-line-strong bg-surface p-1.5 shadow-pop">
          {activePath ? (
            <button type="button" className="mb-1 w-full rounded px-2 py-1 text-left text-[12px] text-accent hover:bg-surface-2" onClick={() => { onPick(activePath); setOpen(false); }}>
              Attach open file: {activePath.split('/').pop()}
            </button>
          ) : null}
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search project files" aria-label="Search files to attach" className="h-6" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
          <div className="mt-1 max-h-40 overflow-y-auto">
            {results.map((f) => (
              <button key={f.path} type="button" className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[11.5px] hover:bg-surface-2" onClick={() => { onPick(f.path); setOpen(false); setQuery(''); }}>
                {f.path}
              </button>
            ))}
            {results.length === 0 ? <p className="px-2 py-1 text-[11.5px] text-fg-subtle">No files</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatPanel() {
  const messages = useAgentStore((s) => s.managerChatMessages);
  const mode = useAgentStore((s) => s.orchestratorMode);
  const setMode = useAgentStore((s) => s.setOrchestratorMode);
  const teamStrategy = useAgentStore((s) => s.teamStrategy);
  const setTeamStrategy = useAgentStore((s) => s.setTeamStrategy);
  const sovereign = useAgentStore((s) => s.agents['agent-manager']);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const reassign = useAgentStore((s) => s.reassignModel);
  const clearChat = useAgentStore((s) => s.clearChat);
  const mission = useAgentStore((s) => s.activeMission);
  const liveRunning = useAgentStore((s) => s.isLiveRunning);
  const setView = useAgentStore((s) => s.setActiveView);
  const providers = useConnectionsStore((s) => s.providers);
  const loaded = useConnectionsStore((s) => s.loaded);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const model = resolveAgentModel(sovereign, roleDefaults);
  const modelOk = isModelAvailable(providers, model);
  const streaming = messages.some((m) => m.streaming);
  const hint = MODES.find((m) => m.id === mode)?.hint;
  const live = mission?.source === 'live' ? mission : null;
  const done = live ? live.tasks.filter((t) => t.status === 'completed').length : 0;

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text || streaming || !modelOk) return;
    setDraft('');
    const files = attachments;
    setAttachments([]);
    stick.current = true;
    void sendToOrchestrator(text, files);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-1.5">
        <Tabs<OrchestratorMode> label="Orchestrator mode" value={mode} onChange={setMode} items={MODES.map((m) => ({ id: m.id, label: m.label }))} />
        <IconButton icon={Trash2} label="Clear conversation" size="sm" disabled={messages.length === 0 || streaming} onClick={clearChat} />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="shrink-0 whitespace-nowrap text-[11.5px] text-fg-subtle">Sovereign model</span>
        <ModelSelect value={model} onChange={(ref) => reassign('agent-manager', ref)} emptyLabel="Choose a model" className="h-6 flex-1" aria-label="Sovereign model" />
      </div>
      {mode !== 'ask' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <span className="shrink-0 whitespace-nowrap text-[11.5px] text-fg-subtle">Team</span>
          <Select value={teamStrategy} onChange={(e) => setTeamStrategy(e.target.value as TeamStrategy)} aria-label="Team strategy" className="h-6 flex-1">
            <option value="adaptive">Sovereign designs the team for this project</option>
            <option value="fixed">Only use my existing agents</option>
          </Select>
        </div>
      ) : null}
      {mode !== 'ask' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <span className="shrink-0 whitespace-nowrap text-[11.5px] text-fg-subtle">Approval</span>
          <ApprovalModeSelect className="h-6 flex-1" />
        </div>
      ) : null}
      {live && (liveRunning || live.status === 'paused' || live.status === 'failed' || live.status === 'cancelled') ? (
        <div className="shrink-0 space-y-1 border-b border-line bg-surface-2 px-3 py-1.5">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate">{live.title}</span>
            <span className="shrink-0 text-fg-muted">{done}/{live.tasks.length} · {live.status}</span>
          </div>
          <ProgressBar value={live.tasks.length ? (done / live.tasks.length) * 100 : 0} />
          <div className="flex gap-2">
            {liveRunning ? <Button size="sm" variant="danger" icon={Square} onClick={stopRun}>Stop run</Button> : null}
            {!liveRunning && (live.status === 'cancelled' || live.status === 'failed' || live.status === 'paused') ? <Button size="sm" onClick={() => void resumeRun()}>Resume run</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setView('tasks')}>Open tasks</Button>
          </div>
        </div>
      ) : null}
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <EmptyState title="Talk to Sovereign">
            Describe what you want built or changed. Use Ask to discuss, Plan to get a task breakdown with agent assignments, and approve it to run.
          </EmptyState>
        ) : null}
        {messages.map((m) => <Message key={m.id} message={m} />)}
      </div>
      <div className="shrink-0 border-t border-line p-2">
        {loaded && !modelOk ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-[12px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{model ? 'The selected model is not available.' : 'Pick a model for Sovereign to start.'}</span>
            <Button size="sm" onClick={() => setView('connections')}>Connections</Button>
          </div>
        ) : null}
        {attachments.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <Badge key={a} tone="accent" className="gap-1">
                <span className="min-w-0 truncate">{a}</span>
                <button type="button" className="shrink-0" aria-label={`Remove ${a}`} onClick={() => setAttachments((x) => x.filter((p) => p !== a))}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="rounded-xl border border-line bg-surface-2 shadow-card transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          <textarea
            id="orchestrator-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            placeholder={mode === 'ask' ? 'Ask about the project…' : 'Describe what to build or change…'}
            aria-label="Message Sovereign"
            className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[13px] placeholder:text-fg-subtle focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <AttachPicker onPick={(p) => setAttachments((x) => (x.includes(p) ? x : [...x, p]))} />
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[11px] text-fg-subtle" title={hint}>{hint?.split('.')[0]}</span>
              {streaming ? (
                <Button size="sm" variant="danger" icon={Square} onClick={stopChat}>Stop</Button>
              ) : (
                <Button size="sm" variant="primary" icon={ArrowUp} disabled={!draft.trim() || !modelOk} onClick={send}>Send</Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cpu, GraduationCap, ListChecks, ScrollText, Sparkles, Trash2 } from 'lucide-react';
import { useAgentStore, resolveAgentModel, formatClock } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { SidePanel } from '@/components/ui/Dialog';
import { PanelCard, StatTile } from '@/components/ui/Card';
import { Badge, Button, Field, Input, ProgressBar, Select, StatusDot, Textarea } from '@/components/ui/primitives';
import { ModelSelect, fmtDuration, fmtRelative, fmtTokens, modelLabel, statusTone, usageCostLabel } from '@/components/ui/helpers';
import { CORE_AGENT_IDS } from '@/store/defaultState';
import type { AgentProfile, AutonomyLevel } from '@/types';
import { useLayoutStore } from '@/store/useLayoutStore';
import { AgentAvatar } from './vizShared';

const TINT = {
  model: '#2563EB',
  role: '#7C3AED',
  prompt: '#6B7280',
  intern: '#D97706',
  history: '#16A34A',
  activity: '#0D9488',
  danger: '#DC2626',
};

function ConfigForm({ agent }: { agent: AgentProfile }) {
  const update = useAgentStore((s) => s.updateAgent);
  const reassign = useAgentStore((s) => s.reassignModel);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const providers = useConnectionsStore((s) => s.providers);
  const initial = {
    title: agent.title,
    specialty: agent.specialty || '',
    focus: agent.focus || '',
    description: agent.description,
    prompt: agent.systemPrompt,
    caps: agent.capabilities.join(', '),
    review: agent.reviewResponsibilities,
    autonomy: agent.autonomyLevel,
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const effective = resolveAgentModel(agent, roleDefaults);
  const set = <K extends keyof typeof initial>(key: K) => (value: (typeof initial)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = (Object.keys(initial) as Array<keyof typeof initial>).some((k) => form[k] !== initial[k]);

  const save = () => {
    update(agent.id, {
      title: form.title.trim() || agent.title,
      specialty: form.specialty.trim() || undefined,
      focus: form.focus.trim() || undefined,
      description: form.description,
      systemPrompt: form.prompt,
      reviewResponsibilities: form.review,
      autonomyLevel: form.autonomy,
      capabilities: form.caps.split(',').map((c) => c.trim()).filter(Boolean),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <PanelCard icon={Cpu} tint={TINT.model} title="Model" hint={agent.model ? 'Chosen for this agent' : 'Follows the role default'}>
        <Field label="Model" hint={agent.model ? undefined : 'Using the role default: ' + (effective ? modelLabel(providers, effective) : 'none set')}>
          <ModelSelect value={agent.model} onChange={(ref) => reassign(agent.id, ref)} emptyLabel="Use role default" />
        </Field>
        <Field label="Autonomy">
          <Select value={form.autonomy} onChange={(e) => set('autonomy')(e.target.value as AutonomyLevel)}>
            {['Autonomous', 'Semi-Autonomous', 'Supervised', 'Shadowing'].map((a) => <option key={a}>{a}</option>)}
          </Select>
        </Field>
      </PanelCard>

      <PanelCard icon={Sparkles} tint={TINT.role} title="Role and instructions" hint="What Sovereign assigns to this agent">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={form.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="Role / specialty"><Input value={form.specialty} onChange={(e) => set('specialty')(e.target.value)} placeholder="e.g. IoT & Embedded Engineer" /></Field>
        </div>
        <Field label="Domain instructions" hint="Used by Sovereign for assignments and included in every task sent to this agent.">
          <Textarea rows={3} value={form.focus} onChange={(e) => set('focus')(e.target.value)} placeholder="What should this specialist study, build and verify?" />
        </Field>
        <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="Capabilities" hint="Comma separated."><Input value={form.caps} onChange={(e) => set('caps')(e.target.value)} /></Field>
      </PanelCard>

      <PanelCard icon={ScrollText} tint={TINT.prompt} title="Prompt and review" hint="Sent with every task">
        <Field label="Review responsibilities"><Textarea rows={2} value={form.review} onChange={(e) => set('review')(e.target.value)} /></Field>
        <Field label="System prompt"><Textarea rows={7} value={form.prompt} onChange={(e) => set('prompt')(e.target.value)} className="font-mono text-[12px]" /></Field>
      </PanelCard>

      {dirty || saved ? (
        <div className="ahq-pop sticky bottom-0 z-10 -mx-3 -mb-3 flex items-center gap-2 border-t border-line bg-surface/90 px-4 py-2.5 backdrop-blur" data-testid="agent-save-bar">
          {saved && !dirty ? (
            <span className="flex items-center gap-1.5 text-[12px] text-success" role="status"><StatusDot tone="success" /> Saved</span>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-[12px] text-fg-muted"><StatusDot tone="warning" /> Unsaved changes</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setForm(initial)}>Discard</Button>
              <Button variant="primary" size="sm" onClick={save}>Save changes</Button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

export function AgentDetail() {
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const agent = useAgentStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined));
  const agents = useAgentStore((s) => s.agents);
  const activity = useAgentStore((s) => s.activity);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const providers = useConnectionsStore((s) => s.providers);
  const select = useAgentStore((s) => s.selectAgent);
  const remove = useAgentStore((s) => s.removeAgent);
  const graduate = useAgentStore((s) => s.graduateIntern);
  const width = useLayoutStore((s) => s.detailWidth);

  const mine = useMemo(() => activity.filter((e) => e.agentId === selectedId), [activity, selectedId]);
  if (!agent) return null;
  const issues = mine.filter((e) => e.level === 'error' || e.level === 'warn').slice(-6).reverse();
  const logs = mine.slice(-12).reverse();
  const intern = agent.internship;
  const u = agent.tokenUsage;
  const effective = resolveAgentModel(agent, roleDefaults);
  const tone = statusTone(agent.status);
  const done = agent.velocityMetrics.tasksCompleted;
  const failed = agent.velocityMetrics.tasksFailed;

  return (
    <SidePanel
      open
      onClose={() => select(null)}
      width={width}
      tint={agent.accentColor}
      title={agent.name}
      subtitle={agent.title}
      leading={<AgentAvatar agent={agent} size={40} />}
      meta={
        <>
          <Badge tone={tone === 'neutral' ? 'neutral' : tone}><StatusDot tone={tone} pulse={tone === 'accent'} /> {agent.status}</Badge>
          <Badge>{agent.autonomyLevel}</Badge>
          <Badge tone={effective ? 'neutral' : 'warning'} title="Model">
            <Cpu className="h-3 w-3" /> {effective ? modelLabel(providers, effective) : 'No model'}
          </Badge>
          {agent.currentTask ? <span className="w-full truncate text-[12px] text-fg-muted">Working on: {agent.currentTask}</span> : null}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2" data-testid="agent-stats">
        <StatTile label="Tokens" value={u.calls ? fmtTokens(u.totalTokens) : '—'} hint={u.calls ? `${fmtTokens(u.promptTokens)} in · ${fmtTokens(u.completionTokens)} out` : 'No calls yet'} />
        <StatTile label="Estimated cost" value={usageCostLabel(u)} hint={u.unpricedTokens > 0 ? `${fmtTokens(u.unpricedTokens)} tokens unpriced` : 'Measured'} />
        <StatTile label="Calls" value={u.calls} />
        <StatTile label="Tasks done / failed" value={<>{done}<span className="text-fg-subtle"> / </span><span className={failed ? 'text-danger' : undefined}>{failed}</span></>} />
      </div>

      {intern?.isIntern ? (
        <PanelCard icon={GraduationCap} tint={TINT.intern} title="Internship" hint={`Level ${intern.level} · ${intern.levelTitle}`}>
          <p className="text-[12.5px] text-fg-muted">Reviewed by {agents[intern.mentorId]?.name ?? intern.mentorId}</p>
          <ProgressBar value={(intern.xp / intern.targetXp) * 100} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-fg-subtle">{intern.xp} / {intern.targetXp} XP from approved reviews</p>
            {intern.graduatedAt ? <Badge tone="success">Graduated</Badge> : <Button size="sm" disabled={!intern.graduationEligible} onClick={() => graduate(agent.id)}>Graduate to senior</Button>}
          </div>
        </PanelCard>
      ) : null}

      <ConfigForm key={agent.id} agent={agent} />

      <PanelCard icon={ListChecks} tint={TINT.history} title="Task history" hint={agent.taskHistory.length ? `${agent.taskHistory.length} task${agent.taskHistory.length === 1 ? '' : 's'}` : 'Nothing yet'} bodyClassName={agent.taskHistory.length ? 'p-0' : undefined}>
        {agent.taskHistory.length === 0 ? <p className="text-[12px] text-fg-subtle">Completed and failed tasks appear here.</p> : (
          <ul className="divide-y divide-line">
            {agent.taskHistory.slice(-8).reverse().map((t) => (
              <li key={t.runId + t.taskId + t.timestamp} className="px-3.5 py-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{t.title}</span>
                  <Badge tone={t.status === 'completed' ? 'success' : t.status === 'failed' ? 'danger' : 'neutral'}>{t.status}</Badge>
                </div>
                <div className="mt-0.5 text-[11.5px] text-fg-subtle">{t.model} · {fmtDuration(t.durationMs)} · {fmtTokens(t.tokens)} tokens · {fmtRelative(t.timestamp)}</div>
                {t.error ? <div className="mt-0.5 text-[11.5px] text-danger">{t.error}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      {issues.length ? (
        <PanelCard icon={AlertTriangle} tint={TINT.danger} title="Errors and warnings" hint={`${issues.length} recent`}>
          {issues.map((e) => (
            <p key={e.id} className={'text-[12px] ' + (e.level === 'error' ? 'text-danger' : 'text-warning')}>
              <span className="font-mono text-[11px] text-fg-subtle">{formatClock(e.timestamp)}</span> {e.text}
            </p>
          ))}
        </PanelCard>
      ) : null}

      <PanelCard icon={Activity} tint={TINT.activity} title="Recent activity" hint={logs.length ? 'Newest first' : 'Quiet so far'}>
        {logs.length === 0 ? <p className="text-[12px] text-fg-subtle">What this agent does during a run shows up here.</p> : (
          <div className="space-y-0.5 rounded-lg bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed">
            {logs.map((e) => <p key={e.id} className="text-fg-muted"><span className="text-fg-subtle">{formatClock(e.timestamp)}</span> {e.text}</p>)}
          </div>
        )}
      </PanelCard>

      {!CORE_AGENT_IDS.includes(agent.id) ? (
        <PanelCard icon={Trash2} tint={TINT.danger} title="Danger zone" className="border-danger/30">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-fg-muted">Removes {agent.name} from the team. Its history stays in past reports.</p>
            <Button variant="danger" size="sm" onClick={() => remove(agent.id)}>Remove agent</Button>
          </div>
        </PanelCard>
      ) : null}

    </SidePanel>
  );
}

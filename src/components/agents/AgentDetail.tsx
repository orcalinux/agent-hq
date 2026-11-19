import { useMemo, useState } from 'react';
import { useAgentStore, resolveAgentModel, formatClock } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { SidePanel } from '@/components/ui/Dialog';
import { Badge, Button, Field, Input, ProgressBar, Section, Select, StatusDot, Textarea } from '@/components/ui/primitives';
import { ModelSelect, fmtDuration, fmtRelative, fmtTokens, modelLabel, statusTone, usageCostLabel } from '@/components/ui/helpers';
import { CORE_AGENT_IDS } from '@/store/defaultState';
import type { AgentProfile, AutonomyLevel } from '@/types';
import { useLayoutStore } from '@/store/useLayoutStore';

function ConfigForm({ agent }: { agent: AgentProfile }) {
  const update = useAgentStore((s) => s.updateAgent);
  const reassign = useAgentStore((s) => s.reassignModel);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const providers = useConnectionsStore((s) => s.providers);
  const [title, setTitle] = useState(agent.title);
  const [specialty, setSpecialty] = useState(agent.specialty || '');
  const [focus, setFocus] = useState(agent.focus || '');
  const [description, setDescription] = useState(agent.description);
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [caps, setCaps] = useState(agent.capabilities.join(', '));
  const [review, setReview] = useState(agent.reviewResponsibilities);
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(agent.autonomyLevel);
  const [saved, setSaved] = useState(false);
  const effective = resolveAgentModel(agent, roleDefaults);

  const dirty =
    specialty !== (agent.specialty || '') || focus !== (agent.focus || '') || title !== agent.title || description !== agent.description || prompt !== agent.systemPrompt || review !== agent.reviewResponsibilities || autonomy !== agent.autonomyLevel || caps !== agent.capabilities.join(', ');

  const save = () => {
    update(agent.id, {
      title: title.trim() || agent.title,
      specialty: specialty.trim() || undefined,
      focus: focus.trim() || undefined,
      description,
      systemPrompt: prompt,
      reviewResponsibilities: review,
      autonomyLevel: autonomy,
      capabilities: caps.split(',').map((c) => c.trim()).filter(Boolean),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-3">
      <Field label="Model" hint={agent.model ? undefined : 'Using the role default: ' + (effective ? modelLabel(providers, effective) : 'none set')}>
        <ModelSelect value={agent.model} onChange={(ref) => reassign(agent.id, ref)} emptyLabel="Use role default" />
      </Field>
      <Field label="Role / specialty" hint="Enter any domain, such as IoT, embedded systems, robotics or data science.">
        <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="e.g. IoT & Embedded Engineer" />
      </Field>
      <Field label="Domain instructions" hint="Used by Sovereign for assignments and included in every task sent to this agent.">
        <Textarea rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="What should this specialist study, build and verify?" />
      </Field>
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Autonomy">
        <Select value={autonomy} onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}>
          {['Autonomous', 'Semi-Autonomous', 'Supervised', 'Shadowing'].map((a) => <option key={a}>{a}</option>)}
        </Select>
      </Field>
      <Field label="Capabilities" hint="Comma separated."><Input value={caps} onChange={(e) => setCaps(e.target.value)} /></Field>
      <Field label="Review responsibilities"><Textarea rows={2} value={review} onChange={(e) => setReview(e.target.value)} /></Field>
      <Field label="System prompt"><Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-[12px]" /></Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!dirty} onClick={save}>Save changes</Button>
        {saved ? <span className="text-[12px] text-success" role="status">Saved</span> : null}
      </div>
    </div>
  );
}

export function AgentDetail() {
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const agent = useAgentStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined));
  const agents = useAgentStore((s) => s.agents);
  const activity = useAgentStore((s) => s.activity);
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

  return (
    <SidePanel
      open
      onClose={() => select(null)}
      width={width}
      title={agent.name}
      subtitle={
        <span className="flex items-center gap-2">
          <StatusDot tone={statusTone(agent.status)} />
          {agent.title} · {agent.status}
          {agent.currentTask ? ' · ' + agent.currentTask : ''}
        </span>
      }
    >
      <div className="space-y-5">
        <Section title="Usage (measured)">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
            <dt className="text-fg-muted">Tokens</dt><dd className="text-right tabular-nums">{u.calls ? fmtTokens(u.totalTokens) : '—'}</dd>
            <dt className="text-fg-muted">Input / output</dt><dd className="text-right tabular-nums">{u.calls ? fmtTokens(u.promptTokens) + ' / ' + fmtTokens(u.completionTokens) : '—'}</dd>
            <dt className="text-fg-muted">Estimated cost</dt><dd className="text-right tabular-nums">{usageCostLabel(u)}</dd>
            <dt className="text-fg-muted">Calls</dt><dd className="text-right tabular-nums">{u.calls}</dd>
            <dt className="text-fg-muted">Tasks done / failed</dt><dd className="text-right tabular-nums">{agent.velocityMetrics.tasksCompleted} / {agent.velocityMetrics.tasksFailed}</dd>
          </dl>
          {u.unpricedTokens > 0 ? <p className="text-[11.5px] text-fg-subtle">Cost excludes {fmtTokens(u.unpricedTokens)} tokens from models without a known price. Set prices in Connections and models.</p> : null}
        </Section>

        {intern?.isIntern ? (
          <Section title="Internship">
            <p className="text-[12.5px] text-fg-muted">Level {intern.level} · {intern.levelTitle} · reviewed by {agents[intern.mentorId]?.name ?? intern.mentorId}</p>
            <ProgressBar value={(intern.xp / intern.targetXp) * 100} />
            <p className="text-[11.5px] text-fg-subtle">{intern.xp} / {intern.targetXp} XP, earned from approved reviews in real runs.</p>
            {intern.graduatedAt ? <Badge tone="success">Graduated</Badge> : <Button size="sm" disabled={!intern.graduationEligible} onClick={() => graduate(agent.id)}>Graduate to senior</Button>}
          </Section>
        ) : null}

        <Section title="Configuration"><ConfigForm key={agent.id} agent={agent} /></Section>

        <Section title="Task history">
          {agent.taskHistory.length === 0 ? <p className="text-[12px] text-fg-subtle">No completed tasks yet.</p> : null}
          <ul className="divide-y divide-line rounded-md border border-line">
            {agent.taskHistory.slice(-8).reverse().map((t) => (
              <li key={t.runId + t.taskId + t.timestamp} className="px-2.5 py-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{t.title}</span>
                  <Badge tone={t.status === 'completed' ? 'success' : t.status === 'failed' ? 'danger' : 'neutral'}>{t.status}</Badge>
                </div>
                <div className="text-[11.5px] text-fg-subtle">{t.model} · {fmtDuration(t.durationMs)} · {fmtTokens(t.tokens)} tokens · {fmtRelative(t.timestamp)}</div>
                {t.error ? <div className="text-[11.5px] text-danger">{t.error}</div> : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Errors and warnings">
          {issues.length === 0 ? <p className="text-[12px] text-fg-subtle">None recorded.</p> : null}
          {issues.map((e) => <p key={e.id} className={'text-[12px] ' + (e.level === 'error' ? 'text-danger' : 'text-warning')}>{formatClock(e.timestamp)} {e.text}</p>)}
        </Section>

        <Section title="Recent activity">
          {logs.length === 0 ? <p className="text-[12px] text-fg-subtle">No activity yet.</p> : null}
          <div className="font-mono text-[11.5px]">
            {logs.map((e) => <p key={e.id} className="text-fg-muted"><span className="text-fg-subtle">{formatClock(e.timestamp)}</span> {e.text}</p>)}
          </div>
        </Section>

        {!CORE_AGENT_IDS.includes(agent.id) ? (
          <Section title="Danger zone">
            <Button variant="danger" onClick={() => remove(agent.id)}>Remove agent</Button>
          </Section>
        ) : null}
      </div>
    </SidePanel>
  );
}

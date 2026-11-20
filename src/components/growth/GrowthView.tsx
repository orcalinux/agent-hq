import { useEffect, useMemo, useState } from 'react';
import { Activity, Brain, Sprout, Users } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useMemoryStore } from '@/store/useMemoryStore';
import { agentGrowth, FEEDBACK_SOURCES, LEVELS, WEEKS, weeklyLessons, type AgentGrowth } from '@/engine/growth';
import { LESSON_KIND_LABEL, LESSON_KINDS, LESSON_SOURCE_LABEL, TEAM_MEMORY, type LessonKind } from '@/types';
import { PanelCard, StatTile } from '@/components/ui/Card';
import { Badge, Button, PageTitle, ProgressBar, Section, Tabs, Truncate } from '@/components/ui/primitives';
import { fmtRelative, type Tone } from '@/components/ui/helpers';
import { AgentAvatar } from '@/components/agents/vizShared';

const KIND_COLOR: Record<LessonKind, string> = {
  convention: 'var(--accent)',
  pitfall: 'var(--warning)',
  decision: 'var(--success)',
  preference: '#9333EA',
  fact: 'var(--fg-subtle)',
};

const LEVEL_TONE: Tone[] = ['neutral', 'neutral', 'accent', 'success', 'warning'];

type Sort = 'expertise' | 'recent' | 'name';

function WeeklyBars({ values, color = 'var(--accent)', height = 28, label }: { values: number[]; color?: string; height?: number; label: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((n, v) => n + v, 0);
  return (
    <div role="img" aria-label={`${label}: ${total} lesson${total === 1 ? '' : 's'} in ${values.length} weeks, ${values[values.length - 1]} this week`} className="flex items-end gap-[3px]" style={{ height }}>
      {values.map((v, i) => {
        const weeksAgo = values.length - 1 - i;
        return (
          <span
            key={i}
            title={`${weeksAgo === 0 ? 'This week' : weeksAgo === 1 ? 'Last week' : `${weeksAgo} weeks ago`}: ${v} lesson${v === 1 ? '' : 's'}`}
            className="min-w-0 flex-1 rounded-sm transition-[height] duration-500"
            style={{ height: v ? `${Math.max(12, (v / max) * 100)}%` : 2, background: v ? color : 'var(--surface-3)', opacity: v ? 0.45 + 0.55 * (i / (values.length - 1)) : 1 }}
          />
        );
      })}
    </div>
  );
}

function KindMix({ kinds, total }: { kinds: Record<LessonKind, number>; total: number }) {
  const present = LESSON_KINDS.filter((k) => kinds[k]);
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {present.map((k) => <span key={k} style={{ width: `${(kinds[k] / total) * 100}%`, background: KIND_COLOR[k] }} />)}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted" aria-label="Lessons by kind">
        {present.map((k) => (
          <li key={k} className="flex items-center gap-1 whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
            {LESSON_KIND_LABEL[k]} <span className="tabular-nums text-fg-subtle">{kinds[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GrowthCard({ growth, onOpen }: { growth: AgentGrowth; onOpen: () => void }) {
  const { agent, level } = growth;
  const count = growth.lessons.length;
  return (
    <article
      aria-label={`${agent.name} growth`}
      data-testid="growth-card"
      className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${agent.accentColor}, transparent)` }} />
      <header className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        <AgentAvatar agent={agent} size={34} />
        <div className="min-w-0 flex-1">
          <Truncate as="h3" className="text-[13.5px] font-semibold tracking-tight">{agent.name}</Truncate>
          <Truncate className="text-[11.5px] text-fg-subtle">{agent.specialty || agent.title}</Truncate>
        </div>
        <Badge tone={LEVEL_TONE[level.index]} className="shrink-0">{level.name}</Badge>
      </header>

      <div className="space-y-1 px-3.5">
        <ProgressBar value={level.progress} tone={LEVEL_TONE[level.index] === 'neutral' ? 'accent' : LEVEL_TONE[level.index]} />
        <p className="flex min-w-0 justify-between gap-2 text-[11px] text-fg-subtle" data-testid="growth-level">
          <span className="min-w-0 truncate">{level.next ? `${level.toNext} points to ${level.next}` : 'Top level reached'}</span>
          <span className="shrink-0 tabular-nums">{growth.score} pts</span>
        </p>
      </div>

      <dl className="mx-3.5 mt-3 grid grid-cols-4 divide-x divide-line rounded-lg border border-line bg-surface-2/50 text-center">
        {[
          ['Lessons', count, `${growth.thisWeek} this week`],
          ['Confirmed', growth.reinforced, 'Times a lesson was learned again'],
          ['Used', growth.uses, 'Times lessons went into a prompt'],
          ['Tasks', growth.tasksDone, growth.successRate === undefined ? 'No finished tasks yet' : `${growth.successRate}% succeeded`],
        ].map(([label, value, hint]) => (
          <div key={label} className="min-w-0 px-1 py-1.5" title={String(hint)}>
            <dd className="truncate text-[14px] font-semibold tabular-nums">{value}</dd>
            <dt className="truncate text-[10.5px] text-fg-subtle">{label}</dt>
          </div>
        ))}
      </dl>

      <div className="flex-1 space-y-3 px-3.5 py-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-fg-subtle">Focus areas</p>
          {growth.focus.length ? (
            <ul className="flex min-w-0 flex-wrap gap-1" aria-label={`${agent.name} focus areas`}>
              {growth.focus.map((f) => (
                <li key={f.term} className="min-w-0 max-w-full">
                  <Badge tone="accent">{f.term}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-fg-subtle">{count < 2 ? `Shows up as ${agent.name} learns.` : 'Shows up once a subject comes up in two lessons.'}</p>
          )}
        </div>

        {count ? <KindMix kinds={growth.kinds} total={count} /> : null}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-medium text-fg-subtle">Last {WEEKS} weeks</p>
            <WeeklyBars values={growth.weekly} color={agent.accentColor} label={`${agent.name} lessons per week`} />
          </div>
          <div className="text-right text-[11px] text-fg-subtle">
            <p className="tabular-nums" title="Lessons learned from QA, mentor and verification feedback">{growth.fromFeedback} from reviews</p>
            <p className="tabular-nums">{growth.taughtByYou} taught by you</p>
          </div>
        </div>

        {growth.latest ? (
          <div className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-2">
            <p className="truncate text-[10.5px] text-fg-subtle">Latest · {LESSON_SOURCE_LABEL[growth.latest.source]} · {fmtRelative(growth.latest.updatedAt)}</p>
            <Truncate as="p" lines={2} className="text-[12px] leading-snug">{growth.latest.text}</Truncate>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-end border-t border-line px-2 py-1.5">
        <Button size="sm" variant="ghost" icon={Brain} onClick={onOpen} aria-label={`Open ${agent.name}'s memory`}>Open memory</Button>
      </footer>
    </article>
  );
}

export default function GrowthView() {
  const agents = useAgentStore((s) => s.agents);
  const select = useAgentStore((s) => s.selectAgent);
  const setActiveView = useAgentStore((s) => s.setActiveView);
  const lessons = useMemoryStore((s) => s.lessons);
  const error = useMemoryStore((s) => s.error);
  const load = useMemoryStore((s) => s.load);
  const [sort, setSort] = useState<Sort>('expertise');

  useEffect(() => {
    void load();
  }, [load]);

  const growth = useMemo(() => {
    const now = Date.now();
    const rows = Object.values(agents).map((a) => agentGrowth(a, lessons, now));
    if (sort === 'name') return rows.sort((a, b) => a.agent.name.localeCompare(b.agent.name));
    if (sort === 'recent') return rows.sort((a, b) => (b.latest?.updatedAt ?? 0) - (a.latest?.updatedAt ?? 0) || b.score - a.score);
    return rows.sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
  }, [agents, lessons, sort]);

  const team = useMemo(() => lessons.filter((l) => l.agentId === TEAM_MEMORY), [lessons]);
  const weekly = useMemo(() => weeklyLessons(lessons), [lessons]);
  const recent = useMemo(() => [...lessons].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [lessons]);
  const top = useMemo(() => [...growth].sort((a, b) => b.score - a.score)[0], [growth]);
  const open = (agentId: string) => {
    setActiveView('agents');
    select(agentId);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/70 px-5 py-2 backdrop-blur">
        <PageTitle group="Insights" title="Growth" subtitle="What each agent has learned on this project and how its expertise grows." />
        <Tabs
          label="Sort agents"
          className="shrink-0"
          value={sort}
          onChange={setSort}
          items={[
            { id: 'expertise', label: 'Most experienced' },
            { id: 'recent', label: 'Recently learned' },
            { id: 'name', label: 'Name' },
          ]}
        />
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {error ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="growth-totals">
          <StatTile label="Lessons learned" value={lessons.length} hint={`${weekly[weekly.length - 1]} this week`} />
          <StatTile label="From review feedback" value={lessons.filter((l) => FEEDBACK_SOURCES.includes(l.source)).length} hint="QA, mentor and verification" />
          <StatTile label="Taught by you" value={lessons.filter((l) => l.source === 'user').length} hint="Agent panels and /remember" />
          <StatTile label="Used in prompts" value={lessons.reduce((n, l) => n + l.uses, 0)} hint={`${team.length} shared by the team`} />
          <StatTile label="Most experienced" value={top && top.score > 0 ? top.agent.name : '—'} hint={top && top.score > 0 ? `${top.level.name} · ${top.score} pts` : 'Nobody has learned yet'} />
        </div>

        {lessons.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card" data-testid="growth-empty">
            <Sprout className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-[13px] font-medium">No lessons yet</p>
              <p className="text-[12px] text-fg-muted">
                Agents learn from QA and mentor feedback and after each run. Teach one directly with <code className="font-mono">/remember @Name …</code> in the chat or from its Memory panel. Each agent levels up from Newcomer to Expert as its lessons are confirmed, used and its tasks succeed.
              </p>
            </div>
          </div>
        ) : null}

        <Section title="Specialists" action={<span className="truncate text-[11px] text-fg-subtle">Levels: {LEVELS.map((l) => `${l.name} ${l.min}`).join(' · ')} pts</span>}>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {growth.map((g) => <GrowthCard key={g.agent.id} growth={g} onOpen={() => open(g.agent.id)} />)}
          </div>
        </Section>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <PanelCard icon={Activity} tint="#16A34A" title="Team learning" hint={`Lessons learned per week, last ${WEEKS} weeks`}>
            <WeeklyBars values={weekly} color="var(--success)" height={96} label="Team lessons per week" />
            <div className="flex justify-between text-[10.5px] text-fg-subtle"><span>{WEEKS - 1} weeks ago</span><span>This week</span></div>
          </PanelCard>
          <PanelCard icon={Brain} tint="#9333EA" title="Recently learned" hint={recent.length ? 'Newest first' : 'Nothing yet'} bodyClassName="p-0">
            {recent.length ? (
              <ul className="divide-y divide-line" data-testid="growth-feed">
                {recent.map((l) => {
                  const agent = agents[l.agentId];
                  return (
                    <li key={l.id} className="flex min-w-0 items-center gap-2.5 px-3.5 py-2">
                      {agent ? <AgentAvatar agent={agent} size={24} /> : <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-muted"><Users className="h-3.5 w-3.5" /></span>}
                      <div className="min-w-0 flex-1">
                        <Truncate className="text-[12.5px]">{l.text}</Truncate>
                        <p className="truncate text-[11px] text-fg-subtle">{agent?.name ?? 'Whole team'} · {LESSON_SOURCE_LABEL[l.source]} · {fmtRelative(l.updatedAt)}</p>
                      </div>
                      <span className="h-2 w-2 shrink-0 rounded-full" title={LESSON_KIND_LABEL[l.kind]} style={{ background: KIND_COLOR[l.kind] }} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-[12px] text-fg-subtle">New lessons appear here as agents learn.</p>
            )}
          </PanelCard>
        </div>
      </div>
    </div>
  );
}

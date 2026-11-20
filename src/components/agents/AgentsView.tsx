import { useMemo, useState } from 'react';
import { ChevronRight, GraduationCap, Plus, Search, Users } from 'lucide-react';
import { useAgentStore, resolveAgentModel } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useLayoutStore, type AgentsViewMode } from '@/store/useLayoutStore';
import { Badge, Button, Input, PageTitle, StatusDot, Tabs } from '@/components/ui/primitives';
import { IconTile } from '@/components/ui/Card';
import { fmtRelative, fmtTokens, isBusy, modelLabel, providerName, statusTone, usageCostLabel } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { AgentDetail } from './AgentDetail';
import { Presence } from '@/components/ui/motion';
import { AgentGraph } from './AgentGraph';
import { AgentOffice } from './AgentOffice';
import { AddAgentDialog, OnboardInternDialog } from './AgentDialogs';
import { AgentAvatar } from './vizShared';

/** Lower-priority columns appear as the table gets room; the details panel always shows all of them. */
const COLUMN = {
  status: 'hidden @xl:table-cell',
  task: 'hidden @4xl:table-cell',
  usage: 'hidden @5xl:table-cell',
  activity: 'hidden @6xl:table-cell',
};

function AgentTable() {
  const agents = useAgentStore((s) => s.agents);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const select = useAgentStore((s) => s.selectAgent);
  const providers = useConnectionsStore((s) => s.providers);
  const [query, setQuery] = useState('');
  const team = useMemo(() => Object.values(agents), [agents]);
  const rows = team.filter((agent) => {
    const ref = resolveAgentModel(agent, roleDefaults);
    return [agent.name, agent.title, agent.role, agent.specialty, agent.internship?.specialty, ref ? modelLabel(providers, ref) : '', ref ? providerName(providers, ref) : '']
      .some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  });
  const ready = team.filter((agent) => resolveAgentModel(agent, roleDefaults)).length;
  const working = team.filter((agent) => isBusy(agent.status)).length;
  const headers: Array<[string, string]> = [['Agent', ''], ['Model', 'w-full'], ['Status', COLUMN.status], ['Current task', COLUMN.task], ['Usage', COLUMN.usage], ['Last activity', COLUMN.activity]];

  return (
    <div className="h-full overflow-y-auto p-4">
      <section aria-label="Agent team" className="@container overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={Users} tint="var(--accent)" />
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold">Your team <span className="ml-1 font-normal tabular-nums text-fg-subtle">{team.length}</span></h2>
              <p className="truncate text-[11.5px] text-fg-muted">{ready} with a model · {working} working</p>
            </div>
          </div>
          <div className="relative w-60 max-w-full">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-fg-subtle" />
            <Input aria-label="Search agents" placeholder="Search agents, roles or models…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" />
          </div>
        </div>
        <div className="overflow-x-auto">
      <table aria-label="Agents" className="w-full text-left text-[12.5px]">
        <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
          <tr>{headers.map(([header, column]) => <th scope="col" key={header} className={cn("px-4 py-2 font-medium", column)}>{header}</th>)}<th scope="col" className="relative"><span className="sr-only">Details</span></th></tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const ref = resolveAgentModel(a, roleDefaults);
            return (
              <tr
                key={a.id}
                tabIndex={0}
                aria-selected={selectedId === a.id}
                onClick={() => select(a.id)}
                onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(a.id))}
                className={cn('group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent', selectedId === a.id && 'bg-accent-soft')}
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <AgentAvatar agent={a} size={32} />
                    <div className="min-w-0">
                      <div className="max-w-[clamp(6rem,30cqw,14rem)] truncate font-medium">{a.name}</div>
                      <div className="max-w-[clamp(6rem,30cqw,14rem)] truncate text-[11.5px] text-fg-muted">{a.specialty || a.internship?.specialty || a.title}</div>
                    </div>
                  </div>
                </td>
                <td className="ahq-flex-cell px-4 py-3 [--ahq-flex-min:8rem]">
                  <div className="truncate">{ref ? modelLabel(providers, ref) : <span className="text-warning">No model assigned</span>}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-fg-subtle">{ref ? `${providerName(providers, ref)} · ${a.model ? 'Agent model' : 'Role default'}` : 'Choose a model in details'}</div>
                </td>
                <td className={cn('whitespace-nowrap px-4 py-3', COLUMN.status)}><Badge tone={statusTone(a.status)}><StatusDot tone={statusTone(a.status)} pulse={isBusy(a.status)} /><span className="capitalize">{a.status}</span></Badge></td>
                <td className={cn('px-4 py-3 text-fg-muted', COLUMN.task)}><div className="max-w-56 truncate">{a.currentTask ?? 'No active task'}</div></td>
                <td className={cn('whitespace-nowrap px-4 py-3 tabular-nums', COLUMN.usage)}>
                  {a.tokenUsage.calls ? <><div>{fmtTokens(a.tokenUsage.totalTokens)} tokens</div><div className="text-[11.5px] text-fg-subtle">{usageCostLabel(a.tokenUsage)}</div></> : <span className="text-fg-subtle">No calls yet</span>}
                </td>
                <td className={cn('whitespace-nowrap px-4 py-3 text-fg-muted', COLUMN.activity)}>{fmtRelative(a.taskHistory[a.taskHistory.length - 1]?.timestamp)}</td>
                <td className="pr-3">
                  <button type="button" aria-label={`Configure ${a.name}`} onClick={(event) => { event.stopPropagation(); select(a.id); }} className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg">
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center"><p className="font-medium">No agents match your search</p><Button variant="ghost" size="sm" className="mt-2" onClick={() => setQuery('')}>Clear search</Button></td></tr> : null}
        </tbody>
      </table>
        </div>
      </section>
    </div>
  );
}

export default function AgentsView() {
  const view = useLayoutStore((s) => s.agentsView);
  const setLayout = useLayoutStore((s) => s.set);
  const selected = useAgentStore((s) => s.selectedAgentId);
  const unassigned = useAgentStore((s) => Object.values(s.agents).filter((a) => !resolveAgentModel(a, s.roleDefaults)).length);
  const setView = useAgentStore((s) => s.setActiveView);
  const [addOpen, setAddOpen] = useState(false);
  const [internOpen, setInternOpen] = useState(false);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/70 px-5 py-2 backdrop-blur">
        <PageTitle group="Work" title="Agents" subtitle="Manage your team, models and agent activity." />
        <div className="flex shrink-0 items-center gap-2">
          <Tabs<AgentsViewMode>
            label="Agents view"
            value={view}
            onChange={(v) => setLayout({ agentsView: v })}
            items={[{ id: 'list', label: 'List' }, { id: 'graph', label: 'Graph' }, { id: 'office', label: 'Office' }]}
          />
          <Button icon={GraduationCap} onClick={() => setInternOpen(true)}>Onboard junior</Button>
          <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Add agent</Button>
        </div>
      </header>
      {unassigned > 0 ? (
        <div className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-1.5 text-[12px] text-warning">
          <Badge tone="warning" className="shrink-0">{unassigned} without a model</Badge>
          <span className="min-w-0 truncate">Agents with no model cannot run tasks. Assign models here or set role defaults.</span>
          <Button size="sm" className="ml-auto" onClick={() => setView('connections')}>Role defaults</Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === 'list' && <AgentTable />}
          {view === 'graph' && <AgentGraph />}
          {view === 'office' && <AgentOffice />}
        </div>
        <Presence value={selected}>{(id, open) => <AgentDetail selectedId={id} open={open} />}</Presence>
      </div>
      <AddAgentDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <OnboardInternDialog open={internOpen} onClose={() => setInternOpen(false)} />
    </div>
  );
}

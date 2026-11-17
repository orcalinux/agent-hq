import { useMemo, useState } from 'react';
import { GraduationCap, Plus } from 'lucide-react';
import { useAgentStore, resolveAgentModel } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useLayoutStore, type AgentsViewMode } from '@/store/useLayoutStore';
import { Badge, Button, StatusDot, Tabs } from '@/components/ui/primitives';
import { fmtRelative, fmtTokens, isBusy, modelLabel, providerName, statusTone, usageCostLabel } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { AgentDetail } from './AgentDetail';
import { AgentGraph } from './AgentGraph';
import { AgentOffice } from './AgentOffice';
import { AddAgentDialog, OnboardInternDialog } from './AgentDialogs';

function AgentTable() {
  const agents = useAgentStore((s) => s.agents);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const select = useAgentStore((s) => s.selectAgent);
  const providers = useConnectionsStore((s) => s.providers);
  const rows = useMemo(() => Object.values(agents), [agents]);
  const headers = ['Agent', 'Role', 'Model', 'Provider', 'Current task', 'Status', 'Tokens', 'Est. cost', 'Last activity'];

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[900px] text-left text-[12.5px]">
        <thead className="sticky top-0 z-10 border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
          <tr>{headers.map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
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
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(a.id))}
                className={cn('cursor-pointer border-b border-line hover:bg-surface-2', selectedId === a.id && 'bg-accent-soft')}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-[11.5px] text-fg-subtle">{a.title}</div>
                </td>
                <td className="px-3 py-2 text-fg-muted">{a.internship?.isIntern ? 'junior' : a.role}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{ref ? modelLabel(providers, ref) : <span className="font-sans text-warning">Unassigned</span>}{!a.model && ref ? <span className="ml-1 font-sans text-[11px] text-fg-subtle">(role default)</span> : null}</td>
                <td className="px-3 py-2 text-fg-muted">{ref ? providerName(providers, ref) : '—'}</td>
                <td className="max-w-56 truncate px-3 py-2 text-fg-muted" title={a.currentTask}>{a.currentTask ?? '—'}</td>
                <td className="px-3 py-2"><span className="flex items-center gap-1.5"><StatusDot tone={statusTone(a.status)} pulse={isBusy(a.status)} />{a.status}</span></td>
                <td className="px-3 py-2 tabular-nums">{a.tokenUsage.calls ? fmtTokens(a.tokenUsage.totalTokens) : '—'}</td>
                <td className="px-3 py-2 tabular-nums">{usageCostLabel(a.tokenUsage)}</td>
                <td className="px-3 py-2 text-fg-muted">{fmtRelative(a.taskHistory[a.taskHistory.length - 1]?.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-1.5">
        <div>
          <h1 className="text-[14px] font-semibold">Agents</h1>
          <p className="text-[12px] text-fg-muted">Click an agent to configure it and see its history.</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Badge tone="warning">{unassigned} without a model</Badge>
          <span>Agents with no model cannot run tasks. Assign models here or set role defaults.</span>
          <Button size="sm" className="ml-auto" onClick={() => setView('connections')}>Role defaults</Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === 'list' && <AgentTable />}
          {view === 'graph' && <AgentGraph />}
          {view === 'office' && <AgentOffice />}
        </div>
        {selected ? <AgentDetail /> : null}
      </div>
      <AddAgentDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <OnboardInternDialog open={internOpen} onClose={() => setInternOpen(false)} />
    </div>
  );
}

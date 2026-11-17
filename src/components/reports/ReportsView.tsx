import { useMemo } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { Badge, EmptyState, Section } from '@/components/ui/primitives';
import { fmtCost, fmtDateTime, fmtDuration, fmtTokens, modelLabel, usageCostLabel } from '@/components/ui/helpers';

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
          <tr>{headers.map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function ReportsView() {
  const runs = useAgentStore((s) => s.runHistory);
  const agents = useAgentStore((s) => s.agents);
  const mission = useAgentStore((s) => s.activeMission);
  const providers = useConnectionsStore((s) => s.providers);

  const live = useMemo(() => runs.filter((r) => r.source === 'live'), [runs]);
  const totals = useMemo(() => {
    const all = Object.values(agents);
    return {
      tokens: all.reduce((n, a) => n + a.tokenUsage.totalTokens, 0),
      cost: all.reduce((n, a) => n + a.tokenUsage.estimatedCostUSD, 0),
      unpriced: all.reduce((n, a) => n + a.tokenUsage.unpricedTokens, 0),
      calls: all.reduce((n, a) => n + a.tokenUsage.calls, 0),
    };
  }, [agents]);
  const byModel = useMemo(() => {
    const map = new Map<string, { tasks: number; tokens: number; failed: number }>();
    Object.values(agents).forEach((a) =>
      a.taskHistory.forEach((t) => {
        const row = map.get(t.model) ?? { tasks: 0, tokens: 0, failed: 0 };
        row.tasks += 1;
        row.tokens += t.tokens;
        if (t.status === 'failed') row.failed += 1;
        map.set(t.model, row);
      })
    );
    return [...map.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  }, [agents]);

  const completed = live.filter((r) => r.status === 'completed').length;
  const failed = live.filter((r) => r.status === 'failed').length;
  const cert = mission?.source === 'live' ? mission.qaCertificate : undefined;
  const changes = mission?.source === 'live' ? (mission.proposedChanges ?? []) : [];
  const verification = mission?.source === 'live' ? mission.verification : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-4 py-1.5">
        <div>
          <h1 className="text-[14px] font-semibold">Reports</h1>
          <p className="text-[12px] text-fg-muted">Measured from real runs. Values with no data source show a dash.</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Runs', String(live.length)],
            ['Completed', String(completed)],
            ['Failed', String(failed)],
            ['Model calls', String(totals.calls)],
            ['Tokens', totals.calls ? fmtTokens(totals.tokens) : '—'],
            ['Estimated cost', totals.calls ? (totals.unpriced > 0 ? fmtCost(totals.cost) + '+' : fmtCost(totals.cost)) : '—'],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-fg-muted">{k}</dt><dd className="text-[18px] font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
        {totals.unpriced > 0 ? <p className="-mt-3 text-[11.5px] text-fg-subtle">Cost excludes {fmtTokens(totals.unpriced)} tokens from models with no known price. Subscription CLIs are not billed per token.</p> : null}

        <Section title="Run history">
          {runs.length === 0 ? <EmptyState title="No runs yet">Approve a plan in Workspace to create the first real run.</EmptyState> : (
            <Table headers={['Run', 'Type', 'Status', 'Started', 'Duration', 'Tasks', 'Tokens', 'Cost', 'QA', 'Files proposed / applied']}>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="max-w-64 truncate px-3 py-1.5 font-medium" title={r.title}>{r.title}</td>
                  <td className="px-3 py-1.5">{r.source === 'live' ? <Badge tone="accent">Live</Badge> : <Badge tone="warning">Simulated</Badge>}</td>
                  <td className="px-3 py-1.5"><Badge tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{r.status}</Badge></td>
                  <td className="px-3 py-1.5 text-fg-muted">{fmtDateTime(r.startedAt)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.completedAt ? fmtDuration(r.completedAt - r.startedAt) : '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.tasksCompleted}/{r.tasksTotal}{r.tasksFailed ? ' (' + r.tasksFailed + ' failed)' : ''}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.source === 'live' ? fmtTokens(r.promptTokens + r.completionTokens) : '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.source !== 'live' ? '—' : r.unpricedTokens > 0 && r.costUSD === 0 ? 'unpriced' : fmtCost(r.costUSD) + (r.unpricedTokens > 0 ? '+' : '')}</td>
                  <td className="px-3 py-1.5">{r.qaVerdict ? <Badge tone={r.qaVerdict === 'approve' ? 'success' : 'danger'}>{r.qaVerdict}{r.qaRejectCount ? ' · ' + r.qaRejectCount + ' rework' : ''}</Badge> : '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.filesProposed} / {r.filesApplied}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Usage by agent">
          <Table headers={['Agent', 'Calls', 'Input', 'Output', 'Total tokens', 'Est. cost', 'Tasks done', 'Tasks failed', 'Time on tasks']}>
            {Object.values(agents).map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5 font-medium">{a.name}<span className="ml-1.5 text-fg-subtle">{a.title}</span></td>
                <td className="px-3 py-1.5 tabular-nums">{a.tokenUsage.calls}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.tokenUsage.calls ? fmtTokens(a.tokenUsage.promptTokens) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.tokenUsage.calls ? fmtTokens(a.tokenUsage.completionTokens) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.tokenUsage.calls ? fmtTokens(a.tokenUsage.totalTokens) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{usageCostLabel(a.tokenUsage)}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.velocityMetrics.tasksCompleted}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.velocityMetrics.tasksFailed}</td>
                <td className="px-3 py-1.5 tabular-nums">{a.velocityMetrics.totalDurationMs ? fmtDuration(a.velocityMetrics.totalDurationMs) : '—'}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="Usage by model">
          {byModel.length === 0 ? <p className="text-[12px] text-fg-subtle">No task history yet.</p> : (
            <Table headers={['Model', 'Tasks', 'Failed', 'Tokens']}>
              {byModel.map(([ref, row]) => (
                <tr key={ref} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[12px]">{modelLabel(providers, ref)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row.tasks}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row.failed}</td>
                  <td className="px-3 py-1.5 tabular-nums">{fmtTokens(row.tokens)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Latest live run: verification and release">
          {!mission || mission.source !== 'live' ? <p className="text-[12px] text-fg-subtle">No live run in this session.</p> : (
            <div className="space-y-3 text-[12.5px]">
              <div>
                <span className="text-fg-muted">Verification command: </span>
                {verification ? (
                  <>
                    <code className="font-mono">{verification.command}</code>{' '}
                    <Badge tone={verification.exitCode === 0 ? 'success' : 'danger'}>exit {verification.exitCode ?? '—'}</Badge>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11.5px]">{verification.output || '(no output)'}</pre>
                  </>
                ) : <span className="text-fg-subtle">none was run. Set one in Settings to have QA run real checks.</span>}
              </div>
              <div>
                <div className="mb-1 text-fg-muted">Files proposed by agents</div>
                {changes.length === 0 ? <p className="text-fg-subtle">None.</p> : changes.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border-b border-line py-1 last:border-0"><span className="font-mono text-[12px]">{c.path}</span><Badge tone={c.status === 'applied' ? 'success' : c.status === 'discarded' ? 'neutral' : 'warning'}>{c.status}</Badge></div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-fg-muted">Release certificate</div>
                {cert ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                    <dt className="text-fg-muted">Certificate</dt><dd className="font-mono text-[12px]">{cert.certificateId}</dd>
                    <dt className="text-fg-muted">Signed by</dt><dd>{cert.signedByName} ({modelLabel(providers, cert.signedByModel)})</dd>
                    <dt className="text-fg-muted">Verdict</dt><dd>{cert.qaVerdict ?? '—'}</dd>
                    <dt className="text-fg-muted">SHA-256</dt><dd className="break-all font-mono text-[11.5px]">{cert.sha256Hash}</dd>
                    <dt className="text-fg-muted">Covers</dt><dd>{cert.hashScope ?? '—'}</dd>
                    <dt className="text-fg-muted">Notes</dt><dd className="whitespace-pre-wrap">{cert.summaryNotes}</dd>
                  </dl>
                ) : <p className="text-fg-subtle">Issued only when the QA gate approves a live run.</p>}
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

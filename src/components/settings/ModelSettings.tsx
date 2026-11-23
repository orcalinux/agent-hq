import { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { BALANCES, LOW_QUOTA_PERCENT, QUOTA_POLL_MS, QUOTA_STALE_MS, activeMagpieGroups, useMagpieStore } from '@/store/useMagpieStore';
import { useRouting } from '@/components/models/useRouting';
import { Badge, Button, ProgressBar, Tabs, Truncate } from '@/components/ui/primitives';
import { ModelSelect, fmtRelative, fmtUntil } from '@/components/ui/helpers';
import { COMPLEXITIES, COMPLEXITY_HINT, COMPLEXITY_LABEL, SOURCE_HINT, SOURCE_LABEL } from '@/engine/modelRouting';
import { CHECK_INTERVALS } from '@/engine/modelWatch';
import type { MagpieBalance } from '@/api/client';
import type { Complexity, LevelMode, ModelScope } from '@/types';

type LevelFilter = 'all' | Complexity;

const label = 'text-[12px] font-medium text-fg-muted';
const hint = 'text-[11.5px] text-fg-subtle';
const tableWrap = 'overflow-x-auto rounded-xl border border-line bg-surface';
const tableHead = 'border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle';

function Head({ cols }: { cols: string[] }) {
  return (
    <thead className={tableHead}>
      <tr>{cols.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-1.5 font-medium">{h}</th>)}</tr>
    </thead>
  );
}

/** Who decides what, in plain words. */
function HowItWorks() {
  const b = 'font-medium text-fg';
  return (
    <section aria-label="How model choice works" className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[12.5px] font-medium">How model choice works</p>
      <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-fg-muted">
        <li><strong className={b}>It is dynamic, not a one-time setup.</strong> At every plan Sovereign rates each task as simple, standard or complex, and the model is chosen from whatever is connected at that moment.</li>
        <li><strong className={b}>Three parts decide, in this order:</strong> your setup (what you pinned or locked), then Sovereign (it may pick a better model for a task and says why), then Agent HQ&apos;s ranking for the level. With Magpie routing on, Magpie then picks which subscription serves each request by the quota it has left.</li>
        <li><strong className={b}>Auto</strong> levels follow your connections, new releases (a new GPT or Claude is recognised without an update) and real results. Equally good models from different vendors take turns.</li>
        <li><strong className={b}>Preferred</strong> is your starting point: Sovereign may still choose another model for a task, with a reason shown in the plan. <strong className={b}>Locked</strong> always uses your model. <strong className={b}>Force my setup</strong> locks everything at once.</li>
        <li>If a provider runs out of credit during a run, its tasks move to the best model of the same level elsewhere.</li>
      </ul>
      <p className="pt-1 text-[12px] font-medium text-fg-muted">Choose models yourself</p>
      <ol className="list-decimal space-y-1 pl-4 text-[11.5px] text-fg-muted">
        <li>Per task: in the plan card, before you approve, change a task&apos;s Complexity or Model. Your change wins.</li>
        <li>Per level: pin a model below for Simple, Standard or Complex, as Preferred or Locked.</li>
        <li>Per agent: in Agents, open an agent and set &quot;How this model is used&quot; to Always this model.</li>
      </ol>
    </section>
  );
}

function MagpieRouting() {
  const routing = useRouting();
  const providers = useConnectionsStore((s) => s.providers);
  const connected = Boolean(providers.find((p) => p.id === 'magpie')?.connection);
  const enabled = useMagpieStore((s) => s.enabled);
  const balance = useMagpieStore((s) => s.balance);
  const synced = useMagpieStore((s) => s.synced);
  const syncedAt = useMagpieStore((s) => s.syncedAt);
  const syncing = useMagpieStore((s) => s.syncing);
  const syncError = useMagpieStore((s) => s.syncError);
  const quotas = useMagpieStore((s) => s.quotas);
  const quotaError = useMagpieStore((s) => s.quotaError);
  const setEnabled = useMagpieStore((s) => s.setEnabled);
  const setBalance = useMagpieStore((s) => s.setBalance);
  const sync = useMagpieStore((s) => s.sync);
  const loadQuotas = useMagpieStore((s) => s.loadQuotas);
  const nameOf = (id: string) => providers.flatMap((p) => p.models).find((m) => m.ref === `magpie:${id}`)?.name.split(' · ')[0] ?? id;
  const active = activeMagpieGroups();

  const quotasAt = useMagpieStore((st) => st.quotasAt);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!connected) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadQuotas(true);
    };
    refresh();
    const timer = window.setInterval(refresh, QUOTA_POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [connected, loadQuotas]);
  useEffect(() => {
    if (enabled && connected) void sync();
  }, [enabled, connected, sync, routing.peers]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className={label}>Let Magpie pick the account</p>
        <Tabs<string>
          label="Let Magpie pick the account"
          value={enabled ? 'on' : 'off'}
          onChange={(id) => void setEnabled(id === 'on')}
          items={[
            { id: 'off', label: 'Off' },
            { id: 'on', label: 'On', disabled: !connected && !enabled },
          ]}
        />
        {enabled ? (
          <Button size="sm" icon={RefreshCw} disabled={syncing} onClick={() => void sync(true)}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        ) : null}
      </div>
      <p className={hint}>
        {!connected
          ? 'Connect the Magpie gateway in Connections to use this. Agent HQ keeps choosing models itself either way.'
          : enabled
            ? `Agent HQ keeps three groups in Magpie (agenthq-simple, agenthq-standard, agenthq-complex) with the models it ranks best for each level. Auto levels send their tasks to the group, and Magpie picks the subscription that serves each one, and fails over. Groups update by themselves when the ranking changes.${syncedAt ? ` Synced ${fmtRelative(syncedAt)}.` : ''}`
            : 'Agent HQ picks the model; Magpie can also pick which subscription serves it, by quota left, so no plan runs out mid-week. Turning this off removes the agenthq groups from Magpie.'}
      </p>
      {syncError ? <p className="text-[11.5px] text-danger" role="alert">{syncError}</p> : null}
      {enabled ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className={label}>Balance accounts by</p>
            <Tabs<MagpieBalance> label="Balance accounts by" value={balance} onChange={(b) => void setBalance(b)} items={BALANCES.map((b) => ({ id: b.id, label: b.label }))} />
          </div>
          <p className={hint}>{BALANCES.find((b) => b.id === balance)?.hint}</p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Magpie groups">
            {COMPLEXITIES.map((tier) => (
              <li key={tier} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                <span className="w-20 shrink-0 font-medium">{COMPLEXITY_LABEL[tier]}</span>
                <Truncate className="min-w-0 flex-1 text-fg-muted">{synced[tier] ? synced[tier]!.models.map(nameOf).join(' + ') : 'Not offered through Magpie; Agent HQ routes it directly'}</Truncate>
                {active[tier] ? <Badge tone="success">in use</Badge> : synced[tier] ? <Badge>pinned level</Badge> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {connected ? (
        <div className="space-y-1.5" aria-label="Subscription quota">
          <div className="flex flex-wrap items-center gap-2">
            <p className={label}>Quota left</p>
            <span className="text-[11px] text-fg-subtle" data-testid="quota-updated">
              {quotaError ? `Could not refresh · last reading ${fmtRelative(quotasAt ?? undefined)}` : `Live · updated ${fmtRelative(quotasAt ?? undefined)}`}
            </span>
            <Button
              size="sm"
              icon={RefreshCw}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void loadQuotas(true).finally(() => setRefreshing(false));
              }}
            >
              Refresh
            </Button>
          </div>
          {quotas.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {quotas.map((q) => (
                <li key={q.provider} className="space-y-1.5 rounded-xl border border-line bg-surface px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Truncate className="text-[12.5px] font-medium">{q.name}</Truncate>
                    {q.plan ? <Badge className="shrink-0">{q.plan}</Badge> : null}
                    {q.readAt && Date.now() - Date.parse(q.readAt) > QUOTA_STALE_MS ? <Badge tone="warning" className="shrink-0" title={`Magpie last read this subscription ${fmtRelative(Date.parse(q.readAt))}.`}>stale</Badge> : null}
                  </div>
                  {q.windows.map((w) => (
                    <div key={w.name} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="truncate text-fg-muted">{w.name}</span>
                        <span className="shrink-0 tabular-nums">{w.remaining}% left{w.resetsAt ? ` · resets ${fmtUntil(Date.parse(w.resetsAt))}` : ''}</span>
                      </div>
                      <ProgressBar value={w.remaining} tone={w.remaining < LOW_QUOTA_PERCENT ? 'danger' : w.remaining < 30 ? 'warning' : 'success'} />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className={hint}>{quotaError ?? 'Magpie reports no subscriptions with a quota.'}</p>
          )}
          {quotaError && quotas.length ? <p className="text-[11.5px] text-warning" role="status">{quotaError} The bars above may be out of date.</p> : null}
          <p className={hint}>Below {LOW_QUOTA_PERCENT}% left, Agent HQ gives a level&apos;s tasks to an equally good model on another subscription, if there is one.</p>
        </div>
      ) : null}
    </div>
  );
}

function Decisions() {
  const decisions = useModelWatchStore((s) => s.decisions);
  const providers = useConnectionsStore((s) => s.providers);
  const nameOf = (ref: string) => providers.flatMap((p) => p.models).find((m) => m.ref === ref)?.name.split(' · ')[0] ?? (ref || '—');
  return (
    <div className="space-y-2">
      <p className={label}>Recent decisions</p>
      <p className={hint}>The model each approved task got, and which part decided it.</p>
      <div className={tableWrap}>
        <table aria-label="Recent model decisions" className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">
          <Head cols={['Task', 'Agent', 'Level', 'Model', 'Decided by', 'Why']} />
          <tbody>
            {decisions.slice(0, 12).map((d, i) => (
              <tr key={`${d.at}-${i}`} className="border-b border-line last:border-0">
                <td className="max-w-[14rem] px-3 py-1.5"><Truncate className="font-medium">{d.task}</Truncate></td>
                <td className="max-w-[8rem] px-3 py-1.5 text-fg-muted"><Truncate>{d.agent}</Truncate></td>
                <td className="px-3 py-1.5 text-fg-muted">{COMPLEXITY_LABEL[d.tier]}</td>
                <td className="max-w-[12rem] px-3 py-1.5"><Truncate>{nameOf(d.model)}</Truncate></td>
                <td className="px-3 py-1.5"><Badge tone={d.source === 'auto' ? 'success' : d.source === 'locked' ? 'warning' : d.source === 'you' || d.source === 'sovereign' ? 'accent' : 'neutral'}>{SOURCE_LABEL[d.source]}{d.viaMagpie ? ' · Magpie' : ''}</Badge></td>
                <td className="max-w-[18rem] px-3 py-1.5 text-fg-subtle"><Truncate>{d.reason ?? SOURCE_HINT[d.source]}</Truncate></td>
              </tr>
            ))}
            {!decisions.length ? <tr><td colSpan={6} className="px-3 py-3 text-fg-subtle">Approve a plan to see how its models were chosen.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ModelSettings() {
  const scope = useAgentStore((s) => s.modelScope);
  const setScope = useAgentStore((s) => s.setModelScope);
  const enabled = useAgentStore((s) => s.complexityRouting);
  const setEnabled = useAgentStore((s) => s.setComplexityRouting);
  const pinned = useAgentStore((s) => s.tierModels);
  const setTier = useAgentStore((s) => s.setTierModel);
  const modes = useAgentStore((s) => s.tierModes);
  const setMode = useAgentStore((s) => s.setTierMode);
  const force = useAgentStore((s) => s.forceSetup);
  const setForce = useAgentStore((s) => s.setForceSetup);
  const lockedAgents = useAgentStore((s) => Object.values(s.agents).filter((a) => a.modelLocked && a.model).length);
  const providers = useConnectionsStore((s) => s.providers);
  const routing = useRouting();
  const magpieOn = useMagpieStore((s) => s.enabled);
  const providerCount = new Set(routing.models.map((m) => m.provider)).size;
  const providerOf = (ref: string) => routing.models.find((m) => m.ref === ref)?.provider;
  const interval = useModelWatchStore((s) => s.intervalHours);
  const setInterval = useModelWatchStore((s) => s.setIntervalHours);
  const lastCheckedAt = useModelWatchStore((s) => s.lastCheckedAt);
  const checking = useModelWatchStore((s) => s.checking);
  const lastError = useModelWatchStore((s) => s.lastError);
  const history = useModelWatchStore((s) => s.history);
  const moves = useModelWatchStore((s) => s.tierMoves);
  const check = useModelWatchStore((s) => s.check);
  const resetResults = useModelWatchStore((s) => s.resetResults);
  const [level, setLevel] = useState<LevelFilter>('all');
  const nameOf = (ref: string) => providers.flatMap((p) => p.models).find((m) => m.ref === ref)?.name ?? ref;
  const recent = [
    ...history.map((c) => ({ at: c.at, text: [c.added.length ? `New: ${c.added.map((m) => m.name).join(', ')}` : '', c.removed.length ? `Removed: ${c.removed.map((m) => m.name).join(', ')}` : ''].filter(Boolean).join(' · '), who: c.provider })),
    ...moves.map((m) => ({ at: m.at, text: `${COMPLEXITY_LABEL[m.tier]} tasks moved to ${nameOf(m.to)}`, who: 'Routing' })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  const rows = routing.ranked.filter((m) => level === 'all' || m.tier === level).slice(0, 40);
  const inUse = new Set(COMPLEXITIES.flatMap((c) => routing.peers[c]));
  const learnedCount = Object.keys(routing.results).length;
  const peerLabel = (tier: Complexity) => routing.peers[tier].map((r) => nameOf(r).split(' · ')[0]).join(' + ');
  const modeOf = (tier: Complexity): LevelMode => (force ? 'locked' : modes[tier] ?? 'preferred');
  const levelBadge = (tier: Complexity) => {
    if (pinned[tier]) return modeOf(tier) === 'locked' ? <Badge tone="warning">locked</Badge> : <Badge>preferred</Badge>;
    const turns = routing.peers[tier].length > 1;
    return <Badge tone="success" title={turns ? 'Equally strong models take turns' : undefined}>{`auto${turns ? ' · take turns' : ''}${magpieOn ? ' · Magpie' : ''}`}</Badge>;
  };

  return (
    <>
      <HowItWorks />

      <div className="space-y-1">
        <p className={label}>Models agents may use</p>
        <Tabs<ModelScope>
          label="Models agents may use"
          value={scope}
          onChange={setScope}
          className="w-fit"
          items={[
            { id: 'any', label: 'All connected providers' },
            { id: 'sovereign', label: "Only Sovereign's provider" },
          ]}
        />
        <p className={hint}>
          {scope === 'sovereign'
            ? `Every agent runs on ${routing.provider ?? "Sovereign's provider"}, even when others are connected. Change Sovereign's model to switch provider.`
            : `Agent HQ compares the models of all ${providerCount} connected provider${providerCount === 1 ? '' : 's'} and uses the best one for each level; Sovereign can pick another provider's model for a task when it fits better. With one provider connected, everything runs on it.`}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className={label}>Force my setup</p>
          <Tabs<string>
            label="Force my setup"
            value={force ? 'on' : 'off'}
            onChange={(id) => setForce(id === 'on')}
            items={[
              { id: 'off', label: 'Off' },
              { id: 'on', label: 'On' },
            ]}
          />
        </div>
        <p className={hint}>
          {force
            ? `Your setup always wins: every pinned level is locked${lockedAgents ? `, ${lockedAgents} agent${lockedAgents === 1 ? '' : 's'} keep their own model` : ''}, and Sovereign cannot change a task's model. Levels left on Auto still follow the ranking.`
            : 'Off: your pins are a starting point and the AI stays dynamic. Turn on to make every pin and locked agent apply exactly as set.'}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className={label}>Pick the model by task complexity</p>
          <Tabs<string>
            label="Pick the model by task complexity"
            value={enabled ? 'on' : 'off'}
            onChange={(id) => setEnabled(id === 'on')}
            items={[
              { id: 'on', label: 'On' },
              { id: 'off', label: 'Off' },
            ]}
          />
        </div>
        <p className={hint}>
          {enabled
            ? 'Sovereign rates every task as simple, standard or complex, and the task runs on the model for that level, whatever agent does it. Auto picks the strongest model of each level across your providers, newest version first; simple work does not spend the strongest model.'
            : "Tasks run on their agent's own model unless Sovereign picks one (not under Force my setup)."}
        </p>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Model for each complexity">
          {COMPLEXITIES.map((tier) => (
            <li key={tier} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <div className="min-w-[12rem] flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium">{COMPLEXITY_LABEL[tier]}</span>
                  {levelBadge(tier)}
                </div>
                <Truncate as="p" className="block text-[11.5px] text-fg-subtle">{!pinned[tier] && routing.peers[tier].length > 1 ? `${peerLabel(tier)} · ${COMPLEXITY_HINT[tier]}` : COMPLEXITY_HINT[tier]}</Truncate>
              </div>
              {pinned[tier] ? (
                <Tabs<LevelMode>
                  label={`${COMPLEXITY_LABEL[tier]} level mode`}
                  value={modeOf(tier)}
                  onChange={(m) => setMode(tier, m)}
                  className="shrink-0"
                  items={[
                    { id: 'preferred', label: 'Preferred', disabled: force },
                    { id: 'locked', label: 'Locked' },
                  ]}
                />
              ) : null}
              <ModelSelect
                value={pinned[tier] ?? ''}
                onChange={(ref) => setTier(tier, ref)}
                emptyLabel={`Auto · ${routing.tiers[tier] ? `${nameOf(routing.tiers[tier])}${providerCount > 1 ? ` (${providerOf(routing.tiers[tier])})` : ''}` : 'no model'}`}
                only={routing.refs}
                disabled={!enabled}
                className="h-7 w-56 shrink-0"
                aria-label={`${COMPLEXITY_LABEL[tier]} model`}
              />
            </li>
          ))}
        </ul>
      </div>

      <MagpieRouting />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className={label}>Ranking</p>
          <Tabs<LevelFilter>
            label="Ranking level"
            value={level}
            onChange={setLevel}
            items={[{ id: 'all', label: 'All' }, ...COMPLEXITIES.slice().reverse().map((c) => ({ id: c as LevelFilter, label: COMPLEXITY_LABEL[c] }))]}
          />
          <Button size="sm" icon={RotateCcw} disabled={!learnedCount} onClick={resetResults}>
            Reset learned results
          </Button>
        </div>
        <p className={hint}>Why each model is picked. Score = size of the model, minus points when a newer version of it exists, plus or minus what real tasks on your projects taught (needs 3 results). Duplicates reached through Magpie are kept as backups.</p>
        <div className={tableWrap}>
          <table aria-label="Model ranking" className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">
            <Head cols={['Model', 'Provider', 'Level', 'Score', 'Results', 'Why']} />
            <tbody>
              {rows.map((m) => (
                <tr key={m.ref} className={'border-b border-line last:border-0' + (m.duplicateOf ? ' opacity-55' : '')}>
                  <td className="max-w-[16rem] px-3 py-1.5"><div className="flex min-w-0 items-center gap-1.5"><Truncate className="font-medium">{m.name.split(' · ')[0]}</Truncate>{inUse.has(m.ref) ? <Badge tone="success">In use</Badge> : m.duplicateOf ? <Badge>backup</Badge> : null}</div></td>
                  <td className="max-w-[9rem] px-3 py-1.5 text-fg-muted"><Truncate>{m.provider ?? m.vendor}</Truncate></td>
                  <td className="px-3 py-1.5 text-fg-muted">{COMPLEXITY_LABEL[m.tier]}</td>
                  <td className="px-3 py-1.5 tabular-nums">{m.score}</td>
                  <td className="px-3 py-1.5 tabular-nums text-fg-muted">{m.results ? `${m.results.passed} passed · ${m.results.failed} failed` : '—'}</td>
                  <td className="max-w-[22rem] px-3 py-1.5 text-fg-subtle"><Truncate>{m.why}</Truncate></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={6} className="px-3 py-3 text-fg-subtle">No models connected yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <Decisions />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className={label}>Check providers for new models</p>
          <Tabs<string>
            label="Check providers for new models"
            value={String(interval)}
            onChange={(id) => setInterval(Number(id))}
            items={CHECK_INTERVALS.map((c) => ({ id: String(c.hours), label: c.label }))}
          />
          <Button size="sm" icon={RefreshCw} disabled={checking} onClick={() => void check()}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </div>
        <p className={hint}>
          Re-reads the model list of every connected provider (Claude Code, Codex, Gemini, Ollama, Magpie and API keys) without sending a prompt. New models are announced, and Auto tiers move to the newest model of their family.
          {lastCheckedAt ? ` Last checked ${fmtRelative(lastCheckedAt)}.` : ' Not checked yet.'}
        </p>
        {lastError ? <p className="text-[11.5px] text-danger">Some providers could not be read: {lastError}</p> : null}
        {recent.length ? (
          <ul className="space-y-1" aria-label="Recent model changes">
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex items-center gap-2 text-[11.5px]">
                <span className="shrink-0 text-fg-subtle">{fmtRelative(r.at)}</span>
                <span className="shrink-0 font-medium">{r.who}</span>
                <span className="min-w-0 truncate text-fg-muted">{r.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

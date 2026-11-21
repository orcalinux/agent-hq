import { useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { useRouting } from '@/components/models/useRouting';
import { Badge, Button, Tabs, Truncate } from '@/components/ui/primitives';
import { ModelSelect, fmtRelative } from '@/components/ui/helpers';
import { COMPLEXITIES, COMPLEXITY_HINT, COMPLEXITY_LABEL } from '@/engine/modelRouting';
import { CHECK_INTERVALS } from '@/engine/modelWatch';
import type { Complexity, ModelScope } from '@/types';

type LevelFilter = 'all' | Complexity;

export function ModelSettings() {
  const scope = useAgentStore((s) => s.modelScope);
  const setScope = useAgentStore((s) => s.setModelScope);
  const enabled = useAgentStore((s) => s.complexityRouting);
  const setEnabled = useAgentStore((s) => s.setComplexityRouting);
  const pinned = useAgentStore((s) => s.tierModels);
  const setTier = useAgentStore((s) => s.setTierModel);
  const providers = useConnectionsStore((s) => s.providers);
  const routing = useRouting();
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

  return (
    <>
      <section aria-label="How model choice works" className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
        <p className="text-[12.5px] font-medium">How model choice works</p>
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-fg-muted">
          <li><strong className="font-medium text-fg">It is dynamic, not a one-time setup.</strong> At every plan Sovereign rates each task as simple, standard or complex, and the model is chosen from whatever is connected at that moment.</li>
          <li><strong className="font-medium text-fg">Auto</strong> levels follow your connections, new releases (a new GPT or Claude is recognised without an update) and real results. <strong className="font-medium text-fg">Pinned</strong> levels stay exactly as you set them.</li>
          <li>Models are scored on one scale for every vendor, so no provider wins by being listed first. Models that are equally good take turns, which spreads the work over your subscriptions.</li>
          <li>If a provider runs out of credit during a run, its tasks move to the best model of the same level elsewhere.</li>
        </ul>
        <p className="pt-1 text-[12px] font-medium text-fg-muted">Choose models yourself</p>
        <ol className="list-decimal space-y-1 pl-4 text-[11.5px] text-fg-muted">
          <li>Per task: in the plan card, before you approve, change a task&apos;s Complexity or Model.</li>
          <li>Per level: pin a model below, in Models and routing, for Simple, Standard or Complex.</li>
          <li>Per agent: turn &quot;Pick the model by task complexity&quot; Off, then set each agent&apos;s model in Agents, or the role defaults in Connections.</li>
        </ol>
      </section>

      <div className="space-y-1">
        <p className="text-[12px] font-medium text-fg-muted">Models agents may use</p>
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
        <p className="text-[11.5px] text-fg-subtle">
          {scope === 'sovereign'
            ? `Every agent runs on ${routing.provider ?? "Sovereign's provider"}, even when others are connected. Change Sovereign's model to switch provider.`
            : `Agent HQ compares the models of all ${providerCount} connected provider${providerCount === 1 ? '' : 's'} and uses the best one for each level; Sovereign can pick another provider's model for a task when it fits better. With one provider connected, everything runs on it.`}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12px] font-medium text-fg-muted">Pick the model by task complexity</p>
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
        <p className="text-[11.5px] text-fg-subtle">
          {enabled
            ? 'Sovereign rates every task as simple, standard or complex, and the task runs on the model for that level, whatever agent does it. Auto picks the strongest model of each level across your providers, newest version first; simple work does not spend the strongest model.'
            : "Tasks run on their agent's own model unless Sovereign picks one."}
        </p>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Model for each complexity">
          {COMPLEXITIES.map((tier) => (
            <li key={tier} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium">{COMPLEXITY_LABEL[tier]}</span>
                  {pinned[tier] ? <Badge>pinned</Badge> : <Badge tone="success" title={routing.peers[tier].length > 1 ? 'Equally strong models take turns' : undefined}>{routing.peers[tier].length > 1 ? 'auto · take turns' : 'auto'}</Badge>}
                </div>
                <Truncate as="p" className="block text-[11.5px] text-fg-subtle">{!pinned[tier] && routing.peers[tier].length > 1 ? `${peerLabel(tier)} · ${COMPLEXITY_HINT[tier]}` : COMPLEXITY_HINT[tier]}</Truncate>
              </div>
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12px] font-medium text-fg-muted">Ranking</p>
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
        <p className="text-[11.5px] text-fg-subtle">Why each model is picked. Score = size of the model, minus points when a newer version of it exists, plus or minus what real tasks on your projects taught (needs 3 results). Duplicates reached through Magpie are kept as backups.</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table aria-label="Model ranking" className="w-full text-left text-[12px] [&_td]:whitespace-nowrap">
            <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
              <tr>{['Model', 'Provider', 'Level', 'Score', 'Results', 'Why'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-1.5 font-medium">{h}</th>)}</tr>
            </thead>
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12px] font-medium text-fg-muted">Check providers for new models</p>
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
        <p className="text-[11.5px] text-fg-subtle">
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

import { RefreshCw } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { useRouting } from '@/components/models/useRouting';
import { Badge, Button, Tabs } from '@/components/ui/primitives';
import { ModelSelect, fmtRelative } from '@/components/ui/helpers';
import { COMPLEXITIES, COMPLEXITY_HINT, COMPLEXITY_LABEL } from '@/engine/modelRouting';
import { CHECK_INTERVALS } from '@/engine/modelWatch';
import type { ModelScope } from '@/types';

export function ModelSettings() {
  const scope = useAgentStore((s) => s.modelScope);
  const setScope = useAgentStore((s) => s.setModelScope);
  const enabled = useAgentStore((s) => s.complexityRouting);
  const setEnabled = useAgentStore((s) => s.setComplexityRouting);
  const pinned = useAgentStore((s) => s.tierModels);
  const setTier = useAgentStore((s) => s.setTierModel);
  const providers = useConnectionsStore((s) => s.providers);
  const routing = useRouting();
  const interval = useModelWatchStore((s) => s.intervalHours);
  const setInterval = useModelWatchStore((s) => s.setIntervalHours);
  const lastCheckedAt = useModelWatchStore((s) => s.lastCheckedAt);
  const checking = useModelWatchStore((s) => s.checking);
  const lastError = useModelWatchStore((s) => s.lastError);
  const history = useModelWatchStore((s) => s.history);
  const moves = useModelWatchStore((s) => s.tierMoves);
  const check = useModelWatchStore((s) => s.check);
  const nameOf = (ref: string) => providers.flatMap((p) => p.models).find((m) => m.ref === ref)?.name ?? ref;
  const recent = [
    ...history.map((c) => ({ at: c.at, text: [c.added.length ? `New: ${c.added.map((m) => m.name).join(', ')}` : '', c.removed.length ? `Removed: ${c.removed.map((m) => m.name).join(', ')}` : ''].filter(Boolean).join(' · '), who: c.provider })),
    ...moves.map((m) => ({ at: m.at, text: `${COMPLEXITY_LABEL[m.tier]} tasks moved to ${nameOf(m.to)}`, who: 'Routing' })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  return (
    <>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-fg-muted">Models agents may use</p>
        <Tabs<ModelScope>
          label="Models agents may use"
          value={scope}
          onChange={setScope}
          className="w-fit"
          items={[
            { id: 'sovereign', label: "Sovereign's provider only" },
            { id: 'any', label: 'Any connected provider' },
          ]}
        />
        <p className="text-[11.5px] text-fg-subtle">
          {scope === 'sovereign'
            ? `Every agent runs on ${routing.provider ?? "Sovereign's provider"}, so one subscription is enough. Change Sovereign's model to switch provider.`
            : 'Agents may use any connected provider; Sovereign picks across all of them.'}
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
            ? 'Sovereign rates every task as simple, standard or complex, and the task runs on that model, whatever agent does it. Simple work does not spend the strongest model.'
            : "Tasks run on their agent's own model unless Sovereign picks one."}
        </p>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Model for each complexity">
          {COMPLEXITIES.map((tier) => (
            <li key={tier} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium">{COMPLEXITY_LABEL[tier]}</span>
                  {pinned[tier] ? <Badge>pinned</Badge> : <Badge tone="success">auto · newest</Badge>}
                </div>
                <p className="truncate text-[11.5px] text-fg-subtle">{COMPLEXITY_HINT[tier]}</p>
              </div>
              <ModelSelect
                value={pinned[tier] ?? ''}
                onChange={(ref) => setTier(tier, ref)}
                emptyLabel={`Auto · ${routing.tiers[tier] ? nameOf(routing.tiers[tier]) : 'no model'}`}
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

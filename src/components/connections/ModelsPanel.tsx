import { useMemo, useState } from 'react';
import { Compass, Crown, Palette, Plug, Server, ShieldCheck, Sprout, Wand2, type LucideIcon } from 'lucide-react';
import { useConnectionsStore, pricingFor } from '@/store/useConnectionsStore';
import { useAgentStore } from '@/store/useAgentStore';
import { streamChat } from '@/api/client';
import { CONNECTION_METHOD_LABEL, type AgentRole, type ModelInfo, type ProviderState } from '@/types';
import { Badge, Button, EmptyState, Input, StatusDot } from '@/components/ui/primitives';
import { fmtRate, fmtTokens, ModelSelect, PRICING_SOURCE } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';

/** Columns that appear once the table has room, so model names never squeeze to nothing. */
const COLUMN = { context: 'hidden @4xl:table-cell', capabilities: 'hidden @6xl:table-cell', pricing: 'hidden @2xl:table-cell', assigned: 'hidden @5xl:table-cell' };

function ModelRow({ model, provider }: { model: ModelInfo; provider: ProviderState }) {
  const providers = useConnectionsStore((s) => s.providers);
  const userPricing = useConnectionsStore((s) => s.userPricing);
  const setUserPricing = useConnectionsStore((s) => s.setUserPricing);
  const agents = useAgentStore((s) => s.agents);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const pricing = pricingFor(providers, userPricing, model.ref);
  const [editing, setEditing] = useState(false);
  const [inp, setInp] = useState('');
  const [out, setOut] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const users = Object.values(agents).filter((a) => a.model === model.ref).map((a) => a.name);
  const roles = (Object.entries(roleDefaults) as Array<[AgentRole, string]>).filter(([, ref]) => ref === model.ref).map(([role]) => role + ' default');

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await streamChat({ model: model.ref, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 32 });
      const tokens = r.usage?.totalTokens ? ' · ' + r.usage.totalTokens + ' tokens' : '';
      setTestMsg({ ok: true, text: 'Replied "' + r.text.trim().slice(0, 60) + '" in ' + (r.latencyMs / 1000).toFixed(1) + 's' + tokens });
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message });
    }
    setTesting(false);
  };

  const savePricing = () => {
    const a = Number(inp);
    const b = Number(out);
    if (inp !== '' && out !== '' && Number.isFinite(a) && Number.isFinite(b)) setUserPricing(model.ref, { inputPerM: a, outputPerM: b });
    setEditing(false);
  };

  const editable = pricing?.source !== 'provider' && pricing?.source !== 'local' && pricing?.source !== 'account';

  return (
    <tr className="border-b border-line align-top">
      <td className="ahq-flex-cell px-3 py-1.5">
        <div className="truncate font-medium">{model.name}</div>
        <div className="truncate font-mono text-[11px] text-fg-subtle">{model.ref}</div>
      </td>
      <td className="px-3 py-1.5">
        <div className="max-w-40 truncate whitespace-nowrap">{provider.name}</div>
        <div className="max-w-40 truncate text-[11px] text-fg-subtle">{CONNECTION_METHOD_LABEL[model.via]}</div>
      </td>
      <td className={cn('whitespace-nowrap px-3 py-1.5 tabular-nums text-fg-muted', COLUMN.context)}>{model.contextWindow ? model.contextWindow.toLocaleString() : 'unknown'}</td>
      <td className={cn('px-3 py-1.5', COLUMN.capabilities)}>
        <div className="flex max-w-56 flex-wrap gap-1">
          {model.capabilities.length ? model.capabilities.map((c) => <Badge key={c}>{c}</Badge>) : <span className="text-fg-subtle">unknown</span>}
        </div>
      </td>
      <td className={cn('whitespace-nowrap px-3 py-1.5', COLUMN.pricing)}>
        {editing ? (
          <div className="flex items-center gap-1">
            <Input value={inp} onChange={(e) => setInp(e.target.value)} placeholder="in /1M" aria-label="Input price per million tokens" className="h-6 w-20" inputMode="decimal" />
            <Input value={out} onChange={(e) => setOut(e.target.value)} placeholder="out /1M" aria-label="Output price per million tokens" className="h-6 w-20" inputMode="decimal" />
            <Button size="sm" variant="primary" onClick={savePricing}>Save</Button>
          </div>
        ) : pricing ? (
          <span className="inline-flex min-w-0 flex-col" data-testid="model-pricing">
            <span className="tabular-nums">
              {fmtRate(pricing.inputPerM) + ' in / ' + fmtRate(pricing.outputPerM) + ' out'} <span className="text-fg-subtle">per 1M · {PRICING_SOURCE[pricing.source]}</span>
            </span>
            {pricing.cacheReadPerM !== undefined || pricing.cacheWritePerM !== undefined || pricing.longPrompt ? (
              <span className="text-[11px] tabular-nums text-fg-subtle">
                {[
                  pricing.cacheReadPerM !== undefined ? `cache read ${fmtRate(pricing.cacheReadPerM)}` : '',
                  pricing.cacheWritePerM !== undefined ? `write ${fmtRate(pricing.cacheWritePerM)}` : '',
                  pricing.longPrompt ? `${fmtRate(pricing.longPrompt.inputPerM)} / ${fmtRate(pricing.longPrompt.outputPerM)} above ${fmtTokens(pricing.longPrompt.abovePromptTokens)} prompt` : '',
                ].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-fg-subtle">not set</span>
        )}
        {!editing && editable ? (
          <button type="button" className="ml-2 text-[11.5px] text-accent hover:underline" onClick={() => { setInp(pricing ? String(pricing.inputPerM) : ''); setOut(pricing ? String(pricing.outputPerM) : ''); setEditing(true); }}>
            {pricing ? 'Edit' : 'Set price'}
          </button>
        ) : null}
        {pricing?.source === 'user' && !editing ? (
          <button type="button" className="ml-2 text-[11.5px] text-fg-subtle hover:underline" onClick={() => setUserPricing(model.ref, null)}>Clear</button>
        ) : null}
      </td>
      <td className={cn('px-3 py-1.5 text-[12px] text-fg-muted', COLUMN.assigned)}><div className="max-w-48 truncate">{[...roles, ...users].join(', ') || '—'}</div></td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <Button size="sm" loading={testing} onClick={() => void runTest()}>Test</Button>
        {testMsg ? <p className={'mt-1 max-w-48 whitespace-normal break-words text-[11.5px] ' + (testMsg.ok ? 'text-success' : 'text-danger')}>{testMsg.text}</p> : null}
      </td>
    </tr>
  );
}

export function ModelsPanel() {
  const providers = useConnectionsStore((s) => s.providers);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return providers
      .filter((p) => p.connection)
      .flatMap((p) => p.models.filter((model) => model.selectable !== false).map((m) => ({ model: m, provider: p })))
      .filter(({ model }) => !needle || model.ref.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle));
  }, [providers, q]);

  if (!providers.some((p) => p.connection)) {
    return <EmptyState icon={Plug} title="No models yet">Connect a provider to discover its models. Nothing is listed until a provider has been verified.</EmptyState>;
  }
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter models" aria-label="Filter models" className="max-w-xs" />
      <div className="@container overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            <tr>
              {([['Model', ''], ['Provider', ''], ['Context', COLUMN.context], ['Capabilities', COLUMN.capabilities], ['Pricing (USD)', COLUMN.pricing], ['Assigned to', COLUMN.assigned], ['Inference', '']] as const).map(([h, column]) => (
                <th key={h} className={cn('px-3 py-1.5 font-medium', column)}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map(({ model, provider }) => <ModelRow key={model.ref} model={model} provider={provider} />)}</tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-fg-subtle">Context size, capabilities and pricing come from the provider when it reports them. Claude account rates are the API rate card the signed-in Claude Code CLI caches for your account; on a subscription they value usage at API prices and are not a bill. Prices you enter yourself are used only to estimate cost.</p>
    </div>
  );
}

const ROLES: Array<{ role: AgentRole; label: string; agent: string; help: string; icon: LucideIcon }> = [
  { role: 'manager', label: 'Orchestrator', agent: 'Sovereign', help: 'Plans the work and talks to you.', icon: Crown },
  { role: 'architect', label: 'Architect', agent: 'Aegis', help: 'System design and decisions.', icon: Compass },
  { role: 'frontend', label: 'Frontend', agent: 'Pulse', help: 'Builds the user interface.', icon: Palette },
  { role: 'backend', label: 'Backend', agent: 'Titan', help: 'APIs, data and services.', icon: Server },
  { role: 'qa', label: 'QA and security', agent: 'Sentinel', help: 'Reviews output and gates the release.', icon: ShieldCheck },
  { role: 'intern', label: 'Junior agents', agent: 'Nova, Byte', help: 'Small scoped tasks, reviewed by a senior.', icon: Sprout },
];

function RoleProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${done} of ${total} roles ready`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span className="text-[12px] tabular-nums text-fg-muted">{done}/{total}</span>
    </div>
  );
}

export function RoleDefaults() {
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const setRoleDefault = useAgentStore((s) => s.setRoleDefault);
  const providers = useConnectionsStore((s) => s.providers);
  const firstModel = providers.filter((p) => p.connection).flatMap((p) => p.models.filter((model) => model.selectable !== false))[0];
  const empty = ROLES.filter((r) => !roleDefaults[r.role]);
  const done = ROLES.length - empty.length;
  return (
    <section className="space-y-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">{empty.length === 0 ? 'Your team is ready' : 'Choose a model for each role'}</h2>
          <p className="text-[12px] text-fg-muted">
            {empty.length === 0
              ? 'Every role has a model. Start a task from Workspace, or change any role below.'
              : firstModel
                ? <>Fill the {empty.length} empty {empty.length === 1 ? 'role' : 'roles'} with <span className="font-mono text-fg">{firstModel.name}</span>, then change any of them.</>
                : 'Connect a provider first, then its models appear here.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <RoleProgress done={done} total={ROLES.length} />
          {empty.length > 0 && firstModel ? (
            <Button size="sm" variant="primary" icon={Wand2} onClick={() => empty.forEach((r) => setRoleDefault(r.role, firstModel.ref))}>Fill empty roles</Button>
          ) : null}
        </div>
      </div>
      <div className="@container overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            <tr>
              {([['Role', ''], ['Agent', 'hidden @2xl:table-cell'], ['Status', ''], ['Default model', '']] as const).map(([h, column]) => (
                <th key={h} className={cn('px-3 py-1.5 font-medium', column)}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r) => {
              const assigned = Boolean(roleDefaults[r.role]);
              const Icon = r.icon;
              return (
                <tr key={r.role} className="border-b border-line last:border-b-0 hover:bg-surface-2/50">
                  <td className="ahq-flex-cell px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.label}</div>
                        <div className="truncate text-[11.5px] text-fg-subtle">{r.help}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-fg-muted @2xl:table-cell">{r.agent}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <StatusDot tone={assigned ? 'success' : 'warning'} />
                      <span>{assigned ? 'Ready' : 'Needs model'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2"><div className="w-[clamp(13rem,40cqw,24rem)]">
                    <ModelSelect value={roleDefaults[r.role]} onChange={(ref) => setRoleDefault(r.role, ref)} className="w-full" aria-label={`Default model for ${r.label} (${r.agent})`} />
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-fg-subtle">Agents without their own model use their role's default. If a provider runs out of credit during a run, affected agents are rerouted to another connected provider and the switch is logged.</p>
    </section>
  );
}

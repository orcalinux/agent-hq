import { useMemo, useState } from 'react';
import { Compass, Crown, Palette, Plug, Server, ShieldCheck, Sprout, Wand2, type LucideIcon } from 'lucide-react';
import { useConnectionsStore, pricingFor } from '@/store/useConnectionsStore';
import { useAgentStore } from '@/store/useAgentStore';
import { streamChat } from '@/api/client';
import { CONNECTION_METHOD_LABEL, type AgentRole, type ModelInfo, type ProviderState } from '@/types';
import { Badge, Button, EmptyState, Input } from '@/components/ui/primitives';
import { ModelSelect } from '@/components/ui/helpers';

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

  const editable = pricing?.source !== 'provider' && pricing?.source !== 'local';

  return (
    <tr className="border-b border-line align-top">
      <td className="px-3 py-1.5">
        <div className="font-medium">{model.name}</div>
        <div className="font-mono text-[11px] text-fg-subtle">{model.ref}</div>
      </td>
      <td className="px-3 py-1.5">
        {provider.name}
        <div className="text-[11px] text-fg-subtle">{CONNECTION_METHOD_LABEL[model.via]}</div>
      </td>
      <td className="px-3 py-1.5 tabular-nums text-fg-muted">{model.contextWindow ? model.contextWindow.toLocaleString() : 'unknown'}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {model.capabilities.length ? model.capabilities.map((c) => <Badge key={c}>{c}</Badge>) : <span className="text-fg-subtle">unknown</span>}
        </div>
      </td>
      <td className="px-3 py-1.5">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input value={inp} onChange={(e) => setInp(e.target.value)} placeholder="in /1M" aria-label="Input price per million tokens" className="h-6 w-20" inputMode="decimal" />
            <Input value={out} onChange={(e) => setOut(e.target.value)} placeholder="out /1M" aria-label="Output price per million tokens" className="h-6 w-20" inputMode="decimal" />
            <Button size="sm" variant="primary" onClick={savePricing}>Save</Button>
          </div>
        ) : pricing ? (
          <span className="tabular-nums">
            {'$' + pricing.inputPerM + ' in / $' + pricing.outputPerM + ' out'} <span className="text-fg-subtle">per 1M ({pricing.source})</span>
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
      <td className="px-3 py-1.5 text-[12px] text-fg-muted">{[...roles, ...users].join(', ') || '—'}</td>
      <td className="px-3 py-1.5">
        <Button size="sm" loading={testing} onClick={() => void runTest()}>Test</Button>
        {testMsg ? <p className={'mt-1 max-w-48 break-words text-[11.5px] ' + (testMsg.ok ? 'text-success' : 'text-danger')}>{testMsg.text}</p> : null}
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
      .flatMap((p) => p.models.map((m) => ({ model: m, provider: p })))
      .filter(({ model }) => !needle || model.ref.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle));
  }, [providers, q]);

  if (!providers.some((p) => p.connection)) {
    return <EmptyState icon={Plug} title="No models yet">Connect a provider to discover its models. Nothing is listed until a provider has been verified.</EmptyState>;
  }
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter models" aria-label="Filter models" className="max-w-xs" />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            <tr>
              {['Model', 'Provider', 'Context', 'Capabilities', 'Pricing (USD)', 'Assigned to', 'Inference'].map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map(({ model, provider }) => <ModelRow key={model.ref} model={model} provider={provider} />)}</tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-fg-subtle">Context size, capabilities and pricing come from the provider when it reports them. Prices you enter yourself are used only to estimate cost.</p>
    </div>
  );
}

const ROLES: Array<{ role: AgentRole; label: string; agent: string; help: string; icon: LucideIcon; color: string }> = [
  { role: 'manager', label: 'Orchestrator', agent: 'Sovereign', help: 'Plans the work and talks to you.', icon: Crown, color: '#D97706' },
  { role: 'architect', label: 'Architect', agent: 'Aegis', help: 'System design and decisions.', icon: Compass, color: '#7C3AED' },
  { role: 'frontend', label: 'Frontend', agent: 'Pulse', help: 'Builds the user interface.', icon: Palette, color: '#2563EB' },
  { role: 'backend', label: 'Backend', agent: 'Titan', help: 'APIs, data and services.', icon: Server, color: '#0D9488' },
  { role: 'qa', label: 'QA and security', agent: 'Sentinel', help: 'Reviews output and gates the release.', icon: ShieldCheck, color: '#DC2626' },
  { role: 'intern', label: 'Junior agents', agent: 'Nova, Byte', help: 'Small scoped tasks, reviewed by a senior.', icon: Sprout, color: '#DB2777' },
];

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14 shrink-0" role="img" aria-label={`${done} of ${total} roles ready`}>
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="url(#ahq-ring-grad)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.32,.72,0,1)' }} />
        <defs>
          <linearGradient id="ahq-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums">{done}/{total}</span>
    </div>
  );
}

export function RoleDefaults() {
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const setRoleDefault = useAgentStore((s) => s.setRoleDefault);
  const providers = useConnectionsStore((s) => s.providers);
  const firstModel = providers.filter((p) => p.connection).flatMap((p) => p.models)[0];
  const empty = ROLES.filter((r) => !roleDefaults[r.role]);
  const done = ROLES.length - empty.length;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-accent-2/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <ProgressRing done={done} total={ROLES.length} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">{empty.length === 0 ? 'Your team is ready' : 'Choose a model for each role'}</h2>
            <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-fg-muted">
              {empty.length === 0
                ? 'Every role has a model. Start a task from Workspace, or fine-tune any role below.'
                : firstModel
                  ? <>One click fills the {empty.length} empty {empty.length === 1 ? 'role' : 'roles'} with <span className="font-mono text-fg">{firstModel.name}</span>. You can change any of them afterwards.</>
                  : 'Connect a provider first, then models appear here.'}
            </p>
          </div>
          {empty.length > 0 && firstModel ? (
            <Button variant="primary" size="md" icon={Wand2} className="h-8 px-3.5" onClick={() => empty.forEach((r) => setRoleDefault(r.role, firstModel.ref))}>Fill empty roles</Button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {ROLES.map((r) => {
          const assigned = Boolean(roleDefaults[r.role]);
          const Icon = r.icon;
          return (
            <div key={r.role} className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop">
              <div aria-hidden className="absolute inset-x-0 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${r.color}, transparent)` }} />
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: r.color, background: `color-mix(in srgb, ${r.color} 16%, var(--surface))`, boxShadow: `0 0 0 1px color-mix(in srgb, ${r.color} 35%, transparent), 0 6px 18px -8px ${r.color}` }}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13.5px] font-semibold">{r.label}</h3>
                    <span className="text-[11.5px] text-fg-subtle">{r.agent}</span>
                  </div>
                  <p className="text-[12px] text-fg-muted">{r.help}</p>
                </div>
                <span className={assigned ? 'inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-px text-[11px] font-medium text-success' : 'inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-px text-[11px] font-medium text-warning'}>
                  <span className={assigned ? 'h-1.5 w-1.5 rounded-full bg-success' : 'h-1.5 w-1.5 rounded-full bg-warning'} />
                  {assigned ? 'Ready' : 'Needs model'}
                </span>
              </div>
              <ModelSelect value={roleDefaults[r.role]} onChange={(ref) => setRoleDefault(r.role, ref)} className="mt-3 w-full" aria-label={`Default model for ${r.label} (${r.agent})`} />
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-fg-subtle">Agents without their own model use their role's default. If a provider runs out of credit during a run, affected agents are rerouted to another connected provider and the switch is logged.</p>
    </div>
  );
}

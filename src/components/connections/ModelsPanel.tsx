import { useMemo, useState } from 'react';
import { Plug } from 'lucide-react';
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

const ROLES: Array<{ role: AgentRole; label: string; help: string }> = [
  { role: 'manager', label: 'Orchestrator (Sovereign)', help: 'Plans work and talks to you.' },
  { role: 'architect', label: 'Architect (Aegis)', help: 'System design and decisions.' },
  { role: 'frontend', label: 'Frontend (Pulse)', help: 'UI implementation.' },
  { role: 'backend', label: 'Backend (Titan)', help: 'APIs, data and services.' },
  { role: 'qa', label: 'QA and security (Sentinel)', help: 'Reviews output and gates the release.' },
  { role: 'intern', label: 'Junior agents (Nova, Byte)', help: 'Small scoped tasks, reviewed by a senior.' },
];

export function RoleDefaults() {
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const setRoleDefault = useAgentStore((s) => s.setRoleDefault);
  const providers = useConnectionsStore((s) => s.providers);
  const firstModel = providers.filter((p) => p.connection).flatMap((p) => p.models)[0];
  const empty = ROLES.filter((r) => !roleDefaults[r.role]);
  return (
    <div className="max-w-2xl space-y-1">
      <p className="text-[12.5px] text-fg-muted">
        Agents without their own model use the default for their role. You can give each agent its own model in Agents. If a provider runs out of credit during a run, the orchestrator reroutes the affected agents to another connected provider and logs the switch.
      </p>
      {empty.length > 0 && firstModel ? (
        <div className="mb-3 mt-2 flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
          <span className="min-w-0 flex-1 text-[12.5px] text-fg-muted">{empty.length} roles have no default. Fill them with <span className="font-mono text-fg">{firstModel.name}</span>, then change any you like.</span>
          <Button size="sm" onClick={() => empty.forEach((r) => setRoleDefault(r.role, firstModel.ref))}>Fill empty roles</Button>
        </div>
      ) : <div className="mb-3" />}
      {ROLES.map((r) => (
        <div key={r.role} className="flex items-center justify-between gap-4 border-b border-line py-2">
          <div>
            <div className="text-[13px] font-medium">{r.label}</div>
            <div className="text-[12px] text-fg-subtle">{r.help}</div>
          </div>
          <ModelSelect value={roleDefaults[r.role]} onChange={(ref) => setRoleDefault(r.role, ref)} className="w-64" aria-label={'Default model for ' + r.label} />
        </div>
      ))}
    </div>
  );
}

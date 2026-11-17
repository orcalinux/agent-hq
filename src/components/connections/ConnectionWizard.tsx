import { useEffect, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import type { ConnectPayload, TestResult } from '@/api/client';
import { CONNECTION_METHOD_LABEL, type AIProviderId, type ConnectionMethod, type ProviderState } from '@/types';
import { Badge, Button, Field, Input, Spinner, StatusDot } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/utils/cn';

type Step = 'provider' | 'method' | 'auth' | 'test';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'provider', label: 'Provider' },
  { id: 'method', label: 'Method' },
  { id: 'auth', label: 'Authentication' },
  { id: 'test', label: 'Test and save' },
];

const METHOD_HELP: Record<ConnectionMethod, string> = {
  api_key: 'Paste an API key. It is stored on this computer only (file mode 0600) and is never sent back to the browser.',
  env_key: 'Use an API key that is already set as an environment variable for the Agent HQ server.',
  cli: 'Use the developer CLI you are already signed in to, including its subscription login if it supports one. Agent HQ runs the CLI itself; no password or token is read.',
  local_endpoint: 'Connect to a model server running on this machine or your network.',
};

interface Props {
  open: boolean;
  onClose: () => void;
  initialProvider?: AIProviderId;
}

export function ConnectionWizard({ open, onClose, initialProvider }: Props) {
  const providers = useConnectionsStore((s) => s.providers);
  const detection = useConnectionsStore((s) => s.detection);
  const test = useConnectionsStore((s) => s.test);
  const connect = useConnectionsStore((s) => s.connect);
  const [step, setStep] = useState<Step>('provider');
  const [providerId, setProviderId] = useState<AIProviderId | null>(null);
  const [method, setMethod] = useState<ConnectionMethod | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const provider: ProviderState | undefined = providers.find((p) => p.id === providerId);

  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setResult(null);
    setSaved(false);
    setMethod(null);
    setProviderId(initialProvider ?? null);
    setStep(initialProvider ? 'method' : 'provider');
  }, [open, initialProvider]);

  useEffect(() => {
    if (provider) setEndpoint(provider.connection?.endpointUrl ?? provider.defaultEndpoint ?? '');
  }, [provider]);

  const cliInfo = provider?.cliBinary ? detection?.clis.find((c) => c.binary === provider.cliBinary) : undefined;
  const methodAvailable = (m: ConnectionMethod): { ok: boolean; note?: string } => {
    if (!provider) return { ok: false };
    if (m === 'env_key') {
      return provider.envKeyPresent
        ? { ok: true, note: provider.envVars.join(' / ') + ' is set' }
        : { ok: false, note: provider.envVars.join(' / ') + ' is not set' };
    }
    if (m === 'cli') {
      if (!cliInfo) return { ok: false, note: 'Detection has not run' };
      if (!cliInfo.detected) return { ok: false, note: cliInfo.binary + ' is not installed' };
      if (!cliInfo.executionSupported) return { ok: false, note: 'Not supported for model calls' };
      return { ok: true, note: (cliInfo.binary + ' ' + (cliInfo.version ?? '')).trim() };
    }
    return { ok: true };
  };

  const payload = (): ConnectPayload => ({
    providerId: providerId as AIProviderId,
    method: method as ConnectionMethod,
    apiKey: method === 'api_key' ? apiKey : undefined,
    endpointUrl: method === 'local_endpoint' ? endpoint : undefined,
  });

  const authReady = method === 'api_key' ? apiKey.trim().length > 0 : method === 'local_endpoint' ? endpoint.trim().length > 0 : Boolean(method);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setResult(await test(payload()));
    setTesting(false);
  };

  const save = async () => {
    setSaving(true);
    const res = await connect(payload());
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setApiKey('');
    } else {
      setResult(res);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const back = () => setStep(STEPS[Math.max(0, stepIndex - 1)].id);
  const next = () => {
    const to = STEPS[stepIndex + 1].id;
    setStep(to);
    if (to === 'test') void runTest();
  };
  const canNext = step === 'provider' ? Boolean(providerId) : step === 'method' ? Boolean(method) : step === 'auth' ? authReady : false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect a provider"
      description="Verified with a real request before anything is saved."
      width="max-w-xl"
      footer={
        saved ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            {stepIndex > 0 ? <Button onClick={back} disabled={testing || saving}>Back</Button> : null}
            {step !== 'test' ? (
              <Button variant="primary" disabled={!canNext} onClick={next}>Next</Button>
            ) : (
              <>
                <Button onClick={() => void runTest()} loading={testing}>Test again</Button>
                <Button variant="primary" disabled={!result?.ok || testing} loading={saving} onClick={() => void save()}>Save connection</Button>
              </>
            )}
          </>
        )
      }
    >
      <ol className="mb-4 flex flex-wrap items-center gap-2 text-[12px]" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={cn('flex items-center gap-1.5', i <= stepIndex ? 'text-fg' : 'text-fg-subtle')}>
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i <= stepIndex ? 'bg-accent text-accent-fg' : 'bg-surface-3')}>{i + 1}</span>
            {s.label}
            {i < STEPS.length - 1 ? <span className="text-fg-subtle">/</span> : null}
          </li>
        ))}
      </ol>

      {step === 'provider' && (
        <div className="space-y-1.5" role="radiogroup" aria-label="Provider">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={providerId === p.id}
              onClick={() => { setProviderId(p.id); setMethod(null); }}
              className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2 text-left', providerId === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
            >
              <span>
                <span className="block text-[13px] font-medium">{p.name}</span>
                <span className="block text-[12px] text-fg-muted">{p.methods.map((m) => CONNECTION_METHOD_LABEL[m]).join(' · ')}</span>
              </span>
              {p.connection ? <Badge tone="success">Connected</Badge> : null}
            </button>
          ))}
          {providers.length === 0 ? <p className="text-[12.5px] text-danger">Provider list unavailable. Is the Agent HQ server running?</p> : null}
        </div>
      )}

      {step === 'method' && provider && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-fg-muted">{provider.notes}</p>
          <div className="space-y-1.5" role="radiogroup" aria-label="Connection method">
            {provider.methods.map((m) => {
              const avail = methodAvailable(m);
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  disabled={!avail.ok}
                  onClick={() => setMethod(m)}
                  className={cn('w-full rounded-md border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55', method === m ? 'border-accent bg-accent-soft' : 'border-line enabled:hover:bg-surface-2')}
                >
                  <span className="flex items-center justify-between text-[13px] font-medium">
                    {CONNECTION_METHOD_LABEL[m]}
                    {avail.note ? <span className="text-[11.5px] font-normal text-fg-subtle">{avail.note}</span> : null}
                  </span>
                  <span className="block text-[12px] text-fg-muted">{METHOD_HELP[m]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11.5px] text-fg-subtle">A consumer chat subscription does not include API access. Subscriptions only work through an official CLI that supports signing in with them.</p>
        </div>
      )}

      {step === 'auth' && provider && method && (
        <div className="space-y-3">
          {method === 'api_key' ? (
            <Field label={provider.name + ' API key'} hint={<a className="text-accent underline" href={provider.docsUrl} target="_blank" rel="noreferrer">Where do I get a key?</a>}>
              <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key" autoFocus />
            </Field>
          ) : null}
          {method === 'local_endpoint' ? (
            <Field label="Endpoint URL" hint="Ollama listens on http://127.0.0.1:11434 by default.">
              <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} autoFocus />
            </Field>
          ) : null}
          {method === 'env_key' ? <p className="text-[12.5px] text-fg-muted">The key from {provider.envVars.join(' or ')} will be used. It is not copied anywhere.</p> : null}
          {method === 'cli' ? (
            <div className="space-y-1 text-[12.5px] text-fg-muted">
              <p>Agent HQ will run <code className="font-mono">{provider.cliBinary}</code> with a short test prompt to confirm you are signed in.</p>
              {cliInfo?.auth?.checked ? <p className="flex items-center gap-1.5"><StatusDot tone={cliInfo.auth.ok ? 'success' : 'warning'} />{cliInfo.auth.detail}</p> : null}
              <p className="text-fg-subtle">If the test fails, sign in from a terminal using the CLI's own login command, then test again.</p>
            </div>
          ) : null}
        </div>
      )}

      {step === 'test' && (
        <div className="space-y-3" aria-live="polite">
          {testing ? <p className="flex items-center gap-2 text-[12.5px] text-fg-muted"><Spinner />Testing the connection with a real request…</p> : null}
          {result && !result.ok ? (
            <div className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft p-3 text-[12.5px] text-danger" role="alert">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{result.error ?? 'The provider rejected the connection.'}</span>
            </div>
          ) : null}
          {result?.ok ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[12.5px] text-success"><Check className="h-4 w-4" />Verified. {result.detail}</p>
              <div className="rounded-md border border-line">
                <div className="border-b border-line px-3 py-1.5 text-[12px] font-medium">{result.models?.length ?? 0} models discovered</div>
                <ul className="max-h-40 overflow-y-auto">
                  {result.models?.map((m) => <li key={m.ref} className="px-3 py-0.5 font-mono text-[11.5px] text-fg-muted">{m.name}</li>)}
                </ul>
              </div>
            </div>
          ) : null}
          {saved ? <p className="flex items-center gap-1.5 text-[12.5px] text-success"><Check className="h-4 w-4" />Saved. Models are now available to your agents.</p> : null}
        </div>
      )}
    </Dialog>
  );
}

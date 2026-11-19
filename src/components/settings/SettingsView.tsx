import { useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { Badge, Button, Field, Input, Section, Select } from '@/components/ui/primitives';
import { fmtDateTime } from '@/components/ui/helpers';
import { SHORTCUTS } from '@/components/shell/useShortcuts';
import { ApprovalModeCards } from '@/components/shell/ApprovalMode';

export default function SettingsView() {
  const theme = useAgentStore((s) => s.themeMode);
  const setTheme = useAgentStore((s) => s.setThemeMode);
  const verification = useAgentStore((s) => s.verificationCommand);
  const setVerification = useAgentStore((s) => s.setVerificationCommand);
  const clearRunHistory = useAgentStore((s) => s.clearRunHistory);
  const clearChat = useAgentStore((s) => s.clearChat);
  const resetUsage = useAgentStore((s) => s.resetAgentUsage);
  const emailConfig = useAgentStore((s) => s.emailConfig);
  const updateEmail = useAgentStore((s) => s.updateEmailConfig);
  const sendEmail = useAgentStore((s) => s.sendExecutiveEmail);
  const sentEmails = useAgentStore((s) => s.sentEmails);
  const root = useWorkspaceStore((s) => s.root);
  const recent = useWorkspaceStore((s) => s.recent);
  const locked = useWorkspaceStore((s) => s.lockedByEnv);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const resetLayout = useLayoutStore((s) => s.reset);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [verify, setVerify] = useState(verification);

  const changeRoot = async (next: string) => {
    setError(null);
    try {
      await setRoot(next);
      setPath('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
        <h1 className="text-[14px] font-semibold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-8">
          <Section title="Project">
            <p className="text-[12.5px]">Current folder: <code className="font-mono text-[12px]">{root || 'none'}</code></p>
            {locked ? <p className="text-[12px] text-fg-subtle">The folder is fixed by the AGENT_HQ_WORKSPACE environment variable.</p> : (
              <>
                <div className="flex gap-2">
                  <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/absolute/path/to/your/project" aria-label="Project folder" />
                  <Button variant="primary" disabled={!path.trim()} onClick={() => void changeRoot(path.trim())}>Open project</Button>
                </div>
                {error ? <p className="text-[12px] text-danger" role="alert">{error}</p> : null}
                {recent.length ? (
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-fg-muted">Recent</p>
                    {recent.filter((r) => r !== root).map((r) => (
                      <button key={r} type="button" onClick={() => void changeRoot(r)} className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-surface-2">{r}</button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            <p className="text-[11.5px] text-fg-subtle">Agents and the editor can only read and write inside this folder.</p>
          </Section>

          <Section title="Agent permissions">
            <p className="text-[12.5px] text-fg-muted">Choose how much the agents may do without asking. Changes are always reviewed by QA first, stay inside the project folder, and can be undone from the Changes panel.</p>
            <ApprovalModeCards />
          </Section>

          <Section title="Appearance">
            <Field label="Theme">
              <Select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')} className="w-40">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </Field>
            <Button onClick={resetLayout}>Reset panel layout</Button>
          </Section>

          <Section title="QA verification">
            <Field label="Verification command" hint="Run after agents finish so QA sees real results, for example npm test or npx tsc --noEmit. Must be an allowed command; see the terminal.">
              <div className="flex gap-2">
                <Input value={verify} onChange={(e) => { setVerify(e.target.value); setSaved(false); }} placeholder="npm test" />
                <Button disabled={verify === verification} onClick={() => { setVerification(verify.trim()); setSaved(true); }}>Save</Button>
              </div>
            </Field>
            {saved ? <p className="text-[12px] text-success" role="status">Saved</p> : null}
          </Section>

          <Section title="Notifications">
            <p className="text-[12px] text-fg-muted">
              <Badge tone="warning">Not delivered</Badge> Agent HQ has no mail server. Messages are written to a local outbox below and never sent.
            </p>
            <div className="flex gap-2">
              <Input value={emailConfig.email} onChange={(e) => updateEmail({ email: e.target.value })} placeholder="you@example.com" aria-label="Email address" />
              <Button onClick={() => void sendEmail()} disabled={!emailConfig.email}>Add test message</Button>
            </div>
            {sentEmails.length ? (
              <ul className="divide-y divide-line rounded-md border border-line text-[12px]">
                {sentEmails.slice(0, 5).map((m) => <li key={m.id} className="px-3 py-1.5"><div className="font-medium">{m.subject}</div><div className="text-fg-subtle">{m.to} · {fmtDateTime(m.sentAt)} · logged locally</div></li>)}
              </ul>
            ) : null}
          </Section>

          <Section title="Data">
            <div className="flex flex-wrap gap-2">
              <Button onClick={clearChat}>Clear conversation</Button>
              <Button onClick={clearRunHistory}>Clear run history</Button>
              <Button onClick={resetUsage}>Reset agent usage counters</Button>
            </div>
            <p className="text-[11.5px] text-fg-subtle">API keys are not stored in the browser. They live in the local config file managed by the Agent HQ server.</p>
          </Section>

          <Section title="Keyboard shortcuts">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[12.5px]">
              {SHORTCUTS.map((s) => (<div key={s.keys} className="contents"><dt className="font-mono text-[12px] text-fg-muted">{s.keys}</dt><dd>{s.action}</dd></div>))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

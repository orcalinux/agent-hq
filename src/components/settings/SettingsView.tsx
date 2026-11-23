import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Brain, CircleArrowUp, Cpu, Database, FolderOpen, Gauge, Keyboard, Palette, ShieldCheck, TestTube2, Users, type LucideIcon } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { Badge, Button, Field, Input, PageTitle, Tabs } from '@/components/ui/primitives';
import type { TeamStrategy, ThemePreference } from '@/types';
import { fmtDateTime } from '@/components/ui/helpers';
import { SHORTCUTS } from '@/components/shell/useShortcuts';
import { ApprovalModeCards } from '@/components/shell/ApprovalMode';
import { UpdatesSettings } from './UpdatesSettings';
import { MemorySettings } from './MemorySettings';
import { ModelSettings } from './ModelSettings';
import { RunLimitSettings } from './RunLimitSettings';
import { IconTile } from '@/components/ui/Card';
import { useUpdateStore } from '@/desktop/useUpdate';
import { WorkerIsolationSettings } from './WorkerIsolationSettings';

const SECTIONS: Array<{ id: string; title: string; hint: string; icon: LucideIcon; tint: string }> = [
  { id: 'project', title: 'Project', hint: 'The folder agents work in', icon: FolderOpen, tint: '#2563EB' },
  { id: 'permissions', title: 'Agent permissions', hint: 'How much they may do alone', icon: ShieldCheck, tint: '#16A34A' },
  { id: 'limits', title: 'Run limits', hint: 'Cost, tokens, time and loop guard', icon: Gauge, tint: '#DC2626' },
  { id: 'memory', title: 'Memory and learning', hint: 'What agents learn and how it is found', icon: Brain, tint: '#9333EA' },
  { id: 'team', title: 'Team building', hint: 'Who decides which agents work', icon: Users, tint: '#EA580C' },
  { id: 'models', title: 'Models and routing', hint: 'Who picks each model, Magpie accounts, new models', icon: Cpu, tint: '#4F46E5' },
  { id: 'appearance', title: 'Appearance', hint: 'Theme and layout', icon: Palette, tint: '#DB2777' },
  { id: 'updates', title: 'Updates', hint: 'Version and new releases', icon: CircleArrowUp, tint: '#0EA5E9' },
  { id: 'qa', title: 'QA verification', hint: 'Checks run after each task', icon: TestTube2, tint: '#D97706' },
  { id: 'notifications', title: 'Notifications', hint: 'Local outbox', icon: Bell, tint: '#7C3AED' },
  { id: 'data', title: 'Data', hint: 'History and counters', icon: Database, tint: '#0D9488' },
  { id: 'shortcuts', title: 'Keyboard shortcuts', hint: 'Move faster', icon: Keyboard, tint: '#6B7280' },
];

function Section({ id, children }: { id: string; children: ReactNode }) {
  const meta = SECTIONS.find((x) => x.id === id)!;
  const Icon = meta.icon;
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-4 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="shrink-0"><IconTile icon={Icon} tint={meta.tint} /></span>
        <div className="min-w-0 flex-1">
          <h2 id={`settings-${id}-title`} className="truncate text-[13.5px] font-semibold tracking-tight">{meta.title}</h2>
          <p className="truncate text-[11.5px] text-fg-subtle">{meta.hint}</p>
        </div>
      </div>
      <div className="space-y-3 px-5 py-4">{children}</div>
    </section>
  );
}

const TEAM_HINT: Record<TeamStrategy, string> = {
  adaptive: 'For each request Sovereign decides how many agents are needed, creates the specialists and juniors it is missing with names, models and mentors, and assigns the tasks. New agents stay on the team and keep learning. With Full access the plan also runs without waiting for you.',
  fixed: 'Sovereign only assigns tasks to the agents you already have and never adds new ones.',
};

function TeamSettings() {
  const strategy = useAgentStore((s) => s.teamStrategy);
  const setStrategy = useAgentStore((s) => s.setTeamStrategy);
  const maxParallel = useAgentStore((s) => s.maxParallel);
  const setMaxParallel = useAgentStore((s) => s.setMaxParallel);
  const juniors = useAgentStore((s) => Object.values(s.agents).filter((a) => a.internship?.isIntern).length);
  return (
    <>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-fg-muted">Who builds the team</p>
        <Tabs<TeamStrategy>
          label="Who builds the team"
          value={strategy}
          onChange={setStrategy}
          className="w-fit"
          items={[
            { id: 'adaptive', label: 'Sovereign, automatically' },
            { id: 'fixed', label: 'Only my agents' },
          ]}
        />
        <p className="text-[11.5px] text-fg-subtle">{TEAM_HINT[strategy]}</p>
      </div>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-fg-muted">Tasks running at once</p>
        <Tabs<string>
          label="Tasks running at once"
          value={String(maxParallel)}
          onChange={(id) => setMaxParallel(Number(id))}
          className="w-fit"
          items={[
            { id: '1', label: '1' },
            { id: '2', label: '2' },
            { id: '3', label: '3' },
            { id: '5', label: '5' },
            { id: '8', label: '8' },
            { id: '0', label: 'No limit' },
          ]}
        />
        <p className="text-[11.5px] text-fg-subtle">
          {maxParallel === 0
            ? 'Every task whose dependencies are done starts immediately. This can hit provider rate limits and slow your computer.'
            : `Up to ${maxParallel} independent task${maxParallel === 1 ? '' : 's'} run together. `}
          One agent never works on two tasks at once.
        </p>
      </div>
      <p className="text-[11.5px] text-fg-subtle">
        Every junior has an N+1 mentor, a senior or Sovereign as direct manager, who reviews its work before QA.{juniors ? ` ${juniors} junior${juniors === 1 ? '' : 's'} on the team;` : ''} change a mentor from the junior's details in Agents.
      </p>
    </>
  );
}

export default function SettingsView() {
  const updatesRequested = useUpdateStore((store) => store.settingsRequested);
  useEffect(() => {
    if (!updatesRequested) return;
    setActive('updates');
    document.getElementById('settings-updates')?.scrollIntoView({ block: 'start' });
    useUpdateStore.setState({ settingsRequested: false });
  }, [updatesRequested]);
  const [active, setActive] = useState('project');
  const openNotes = useUpdateStore((s) => s.openNotes);
  const themePreference = useAgentStore((s) => s.themePreference);
  const setThemePreference = useAgentStore((s) => s.setThemePreference);
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
      <header className="flex min-h-14 shrink-0 items-center border-b border-line bg-surface/70 px-5 py-2 backdrop-blur">
        <PageTitle group="App" title="Settings" subtitle="Project folder, agent permissions, memory, appearance and QA." />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-5xl items-start gap-8">
          <nav aria-label="Settings sections" className="sticky top-0 hidden w-52 shrink-0 space-y-0.5 lg:block">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const on = active === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  aria-current={on || undefined}
                  onClick={() => { setActive(sec.id); document.getElementById(`settings-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className={`relative flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition-colors ${on ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg'}`}
                >
                  <span aria-hidden className={`absolute left-0 h-4 w-0.5 rounded-full bg-gradient-to-b from-accent to-accent-2 transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{sec.title}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => openNotes('browse')}
              className="mt-3 flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[12px] text-fg-subtle transition-colors hover:text-fg"
            >
              <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">v{__APP_VERSION__}</span>
              What's new
            </button>
          </nav>
          <div className="min-w-0 flex-1 space-y-5 pb-10">
          <Section id="project">
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

          <Section id="permissions">
            <WorkerIsolationSettings />
            <p className="text-[12.5px] text-fg-muted">Choose how much the agents may do without asking. Changes are always reviewed by QA first, stay inside the project folder, and can be undone from the Changes panel.</p>
            <ApprovalModeCards />
          </Section>

          <Section id="limits">
            <RunLimitSettings />
          </Section>

          <Section id="memory">
            <MemorySettings />
          </Section>

          <Section id="team">
            <TeamSettings />
          </Section>

          <Section id="models">
            <ModelSettings />
          </Section>

          <Section id="appearance">
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-fg-muted">Theme</p>
              <Tabs<ThemePreference>
                label="Theme"
                value={themePreference}
                onChange={setThemePreference}
                className="w-fit"
                items={[
                  { id: 'system', label: 'System' },
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
                ]}
              />
              <p className="text-[11.5px] text-fg-subtle">System follows your operating system and switches when it does.</p>
            </div>
            <Button onClick={resetLayout}>Reset panel layout</Button>
          </Section>

          <Section id="updates">
            <UpdatesSettings />
          </Section>

          <Section id="qa">
            <Field label="Verification command" hint="Run after agents finish so QA sees real results, for example npm test or npx tsc --noEmit. Must be an allowed command; see the terminal.">
              <div className="flex gap-2">
                <Input value={verify} onChange={(e) => { setVerify(e.target.value); setSaved(false); }} placeholder="npm test" />
                <Button disabled={verify === verification} onClick={() => { setVerification(verify.trim()); setSaved(true); }}>Save</Button>
              </div>
            </Field>
            {saved ? <p className="text-[12px] text-success" role="status">Saved</p> : null}
          </Section>

          <Section id="notifications">
            <p className="text-[12px] text-fg-muted">
              <Badge tone="warning">Not delivered</Badge> Agent HQ has no mail server. Messages are written to a local outbox below and never sent.
            </p>
            <div className="flex gap-2">
              <Input value={emailConfig.email} onChange={(e) => updateEmail({ email: e.target.value })} placeholder="you@example.com" aria-label="Email address" />
              <Button onClick={() => void sendEmail()} disabled={!emailConfig.email}>Add test message</Button>
            </div>
            {sentEmails.length ? (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card text-[12px]">
                {sentEmails.slice(0, 5).map((m) => <li key={m.id} className="px-3 py-1.5"><div className="font-medium">{m.subject}</div><div className="text-fg-subtle">{m.to} · {fmtDateTime(m.sentAt)} · logged locally</div></li>)}
              </ul>
            ) : null}
          </Section>

          <Section id="data">
            <div className="flex flex-wrap gap-2">
              <Button onClick={clearChat}>Clear conversation</Button>
              <Button onClick={clearRunHistory}>Clear run history</Button>
              <Button onClick={resetUsage}>Reset agent usage counters</Button>
            </div>
            <p className="text-[11.5px] text-fg-subtle">API keys are not stored in the browser. They live in the local config file managed by the Agent HQ server.</p>
          </Section>

          <Section id="shortcuts">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[12.5px]">
              {SHORTCUTS.map((s) => (<div key={s.keys} className="contents"><dt className="whitespace-nowrap font-mono text-[12px] text-fg-muted">{s.keys}</dt><dd className="truncate">{s.action}</dd></div>))}
            </dl>
          </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { create } from 'zustand';
import { ExternalLink } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import licenseText from '../../../LICENSE?raw';

const REPO = 'https://github.com/orcalinux/agent-hq';

const LINKS = [
  { label: 'Website', href: `${REPO}#readme` },
  { label: 'Report an issue', href: `${REPO}/issues/new` },
  { label: 'Releases', href: `${REPO}/releases` },
];

const CREDITS: Array<{ name: string; role: string; href: string }> = [
  { name: 'Electron', role: 'Desktop shell', href: 'https://www.electronjs.org' },
  { name: 'React', role: 'Interface', href: 'https://react.dev' },
  { name: 'Vite', role: 'Build tooling', href: 'https://vite.dev' },
  { name: 'Tailwind CSS', role: 'Styling', href: 'https://tailwindcss.com' },
  { name: 'Zustand', role: 'State', href: 'https://github.com/pmndrs/zustand' },
  { name: 'Lucide', role: 'Icons', href: 'https://lucide.dev' },
  { name: 'electron-updater', role: 'Updates', href: 'https://www.electron.build' },
  { name: 'Magpie', role: 'Design inspiration', href: 'https://github.com/yetone/magpie' },
];

type Tab = 'about' | 'credits' | 'license';

export const useAboutStore = create<{ open: boolean; show: () => void; close: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function AboutDialog() {
  const open = useAboutStore((store) => store.open);
  const close = useAboutStore((store) => store.close);
  const [tab, setTab] = useState<Tab>('about');
  const tabs: Array<[Tab, string]> = [['about', 'About'], ['credits', 'Credits'], ['license', 'License']];
  return (
    <Dialog
      open={open}
      onClose={() => {
        close();
        setTab('about');
      }}
      title="About Agent HQ"
      footer={
        <>
          <span className="text-[11.5px] text-fg-subtle">MIT License · © 2026 Agent HQ contributors</span>
          <div className="flex-1" />
          <Button variant="primary" onClick={close}>Close</Button>
        </>
      }
    >
      <div data-testid="about-dialog" className="py-3">
        <div role="tablist" aria-label="About sections" className="mb-4 inline-flex gap-1 rounded-lg bg-surface-2 p-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('ahq-button rounded-md px-3 py-1 text-[12px] font-medium', tab === id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'about' ? (
          <div className="flex items-start gap-4">
            <img src="/logo.svg" alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-semibold tracking-tight">Agent HQ</h3>
              <p className="mt-0.5 font-mono text-[12px] text-fg-muted">Version {__APP_VERSION__}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">A local command center for teams of AI coding agents: plan, delegate and supervise work across the models you already subscribe to.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {LINKS.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="ahq-button inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-surface-2">
                    {link.label} <ExternalLink className="h-3 w-3 text-fg-subtle" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {tab === 'credits' ? (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Credits">
            {CREDITS.map((credit) => (
              <li key={credit.name} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                <a href={credit.href} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-fg hover:text-accent">{credit.name}</a>
                <span className="shrink-0 text-fg-subtle">{credit.role}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {tab === 'license' ? (
          <pre tabIndex={0} aria-label="MIT License" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-fg-muted">{licenseText}</pre>
        ) : null}
      </div>
    </Dialog>
  );
}

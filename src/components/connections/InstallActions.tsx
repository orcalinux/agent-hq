import { useState } from 'react';
import { Check, Copy, ExternalLink, SquareTerminal } from 'lucide-react';
import { api } from '@/api/client';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { Button } from '@/components/ui/primitives';

export function InstallActions({ id }: { id: string }) {
  const guide = useConnectionsStore((s) => s.detection?.installs?.[id]);
  const detect = useConnectionsStore((s) => s.detect);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!guide) return null;

  const copy = async () => {
    if (!guide.command) return;
    await navigator.clipboard.writeText(guide.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const runInTerminal = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.openTerminal(id);
      window.setTimeout(() => void detect(), 15000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      {guide.command ? <code className="block max-w-56 truncate rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{guide.command}</code> : null}
      <div className="flex items-center gap-1 whitespace-nowrap">
        {guide.command ? (
          <>
            <Button size="sm" variant="primary" icon={SquareTerminal} loading={busy} onClick={() => void runInTerminal()} title="Opens your terminal in this project and runs the command; you see everything it does">
              Install
            </Button>
            <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
          </>
        ) : null}
        <a href={guide.url} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg">
          <ExternalLink className="h-3.5 w-3.5" />{guide.command ? 'Docs' : 'Download'}
        </a>
      </div>
      {error ? <span role="alert" className="text-[11.5px] text-danger">{error}</span> : null}
    </div>
  );
}

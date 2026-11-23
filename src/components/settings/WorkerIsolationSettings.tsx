import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAgentStore } from '@/store/useAgentStore';
import { Tabs } from '@/components/ui/primitives';

export function WorkerIsolationSettings() {
  const running = useAgentStore((state) => state.isLiveRunning);
  const [isolation, setIsolation] = useState<'worktree' | 'proposals' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api.workerSettings().then((value) => setIsolation(value.isolation)).catch((cause) => setError((cause as Error).message));
  }, []);
  const change = async (value: 'worktree' | 'proposals') => {
    setSaving(true);
    setError('');
    try {
      setIsolation((await api.setWorkerIsolation(value)).isolation);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2" data-testid="worker-isolation-settings">
      <p className="text-[12px] font-medium text-fg-muted">Worker recovery copies</p>
      {isolation ? (
        <fieldset disabled={running || saving} className="min-w-0 disabled:opacity-50">
          <Tabs<'worktree' | 'proposals'> label="Worker recovery copies" value={isolation} onChange={(value) => void change(value)} items={[{ id: 'worktree', label: 'Git worktrees' }, { id: 'proposals', label: 'Proposals only' }]} />
        </fieldset>
      ) : null}
      <p className="text-[11.5px] leading-relaxed text-fg-subtle">Git worktrees keep a detached recovery copy for each task attempt, including uncommitted project files and earlier proposals. Originals are merged through the existing approval flow. Non-Git folders and repositories without a first commit use proposals. Worktrees are retained locally for inspection; they use disk space and are not a security sandbox.</p>
      {running ? <p className="text-[11.5px] text-fg-subtle">Stop the current run before changing this setting.</p> : null}
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

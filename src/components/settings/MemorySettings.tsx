import { useEffect, useState } from 'react';
import { Download, FileJson, RefreshCw } from 'lucide-react';
import { api, pullEmbeddingModel } from '@/api/client';
import { useAgentStore } from '@/store/useAgentStore';
import { useMemoryStore, memoryStats } from '@/store/useMemoryStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { Badge, Button, Field, ProgressBar, Select, StatusDot, Tabs } from '@/components/ui/primitives';
import type { LearningMode } from '@/types';

const LEARNING_HINT: Record<LearningMode, string> = {
  'every-run': 'After every finished run, Sovereign writes short lessons for the agents involved. Costs one extra model call per run.',
  feedback: 'Lessons are written only when QA, a mentor or the verification command pushed back during the run.',
  off: 'Agents keep using what they already know, but nothing new is written.',
};

export function MemorySettings() {
  const learningMode = useAgentStore((s) => s.learningMode);
  const setLearningMode = useAgentStore((s) => s.setLearningMode);
  const setActiveView = useAgentStore((s) => s.setActiveView);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const status = useMemoryStore((s) => s.status);
  const loadStatus = useMemoryStore((s) => s.loadStatus);
  const setStatus = useMemoryStore((s) => s.setStatus);
  const setEmbeddingModel = useMemoryStore((s) => s.setEmbeddingModel);
  const lessons = useMemoryStore((s) => s.lessons);
  const file = useMemoryStore((s) => s.file);
  const memoryError = useMemoryStore((s) => s.error);
  const [pull, setPull] = useState<{ status: string; fraction?: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const embedding = status?.embedding;
  const stats = memoryStats(lessons);

  const install = async (model: string) => {
    setMessage(null);
    setPull({ status: 'Starting download' });
    try {
      const next = await pullEmbeddingModel(model, (s, fraction) => setPull({ status: s, fraction }));
      setStatus(next);
      setMessage({ ok: true, text: `${model} is installed. Memory search now matches by meaning as well as keywords.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setPull(null);
    }
  };

  const reindex = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.reindexMemory();
      setMessage({ ok: true, text: `Indexed ${res.indexed} lesson${res.indexed === 1 ? '' : 's'} with ${res.model}.` });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const openMemoryFile = async () => {
    await refreshTree();
    await openFile(file);
    setActiveView('workspace');
  };

  return (
    <>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-fg-muted">Learn from runs</p>
        <Tabs<LearningMode>
          label="Learn from runs"
          value={learningMode}
          onChange={setLearningMode}
          className="w-fit"
          items={[
            { id: 'every-run', label: 'Every run' },
            { id: 'feedback', label: 'Only after feedback' },
            { id: 'off', label: 'Off' },
          ]}
        />
        <p className="text-[11.5px] text-fg-subtle">{LEARNING_HINT[learningMode]}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-line bg-surface-2/60 p-3" data-testid="memory-search-status">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">Memory search</p>
          {status ? (
            <Badge tone={status.mode === 'hybrid' ? 'success' : 'neutral'}>
              <StatusDot tone={status.mode === 'hybrid' ? 'success' : 'neutral'} /> {status.mode === 'hybrid' ? 'Keywords and meaning' : 'Keywords only'}
            </Badge>
          ) : <Badge>Checking…</Badge>}
        </div>
        <p className="text-[11.5px] text-fg-subtle">
          Each task gets the lessons that fit it best. Keyword search always works. With an embedding model in Ollama, lessons that say the same thing in other words are found too; everything stays on this computer.
        </p>
        {embedding && !embedding.reachable ? (
          <p className="text-[12px] text-warning">Ollama is not reachable at {embedding.endpoint}. Install or start it from Connections → Local tools to search by meaning.</p>
        ) : null}
        {embedding?.reachable ? (
          <Field label="Embedding model" hint={embedding.installed.length ? `Installed in Ollama: ${embedding.installed.join(', ')}` : undefined}>
            <Select
              value={embedding.preference === 'auto' || embedding.preference === 'off' || embedding.installed.includes(embedding.preference) ? embedding.preference : 'auto'}
              onChange={(e) => void setEmbeddingModel(e.target.value).catch((err) => setMessage({ ok: false, text: (err as Error).message }))}
              aria-label="Embedding model"
              className="max-w-sm"
            >
              <option value="auto">{`Automatic${embedding.active && embedding.preference === 'auto' ? ` (${embedding.active})` : ''}`}</option>
              {embedding.installed.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="off">Off (keywords only)</option>
            </Select>
          </Field>
        ) : null}
        {embedding?.reachable && !embedding.installed.length ? (
          <div className="space-y-2">
            <p className="text-[12px] text-fg-muted">No embedding model is installed. {embedding.recommended} is small (about 270 MB) and fast on a CPU.</p>
            {pull ? (
              <div className="space-y-1" role="status">
                <ProgressBar value={(pull.fraction ?? 0) * 100} />
                <p className="truncate text-[11.5px] text-fg-subtle">{pull.status}{pull.fraction !== undefined ? ` · ${Math.round(pull.fraction * 100)}%` : ''}</p>
              </div>
            ) : (
              <Button variant="primary" size="sm" icon={Download} onClick={() => void install(embedding.recommended)}>Install {embedding.recommended}</Button>
            )}
          </div>
        ) : null}
        {embedding?.active ? <Button size="sm" icon={RefreshCw} loading={busy} onClick={() => void reindex()}>Rebuild search index</Button> : null}
        {message ? <p className={`text-[12px] ${message.ok ? 'text-success' : 'text-danger'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p> : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-fg-muted">
          {stats.count} lesson{stats.count === 1 ? '' : 's'} in <code className="font-mono text-[11.5px]">{file}</code>, kept with this project. Edit them in each agent's panel or in the file.
        </p>
        <Button size="sm" icon={FileJson} disabled={!stats.count} onClick={() => void openMemoryFile()}>Open file</Button>
      </div>
      {memoryError ? <p className="text-[12px] text-danger" role="alert">{memoryError}</p> : null}
    </>
  );
}

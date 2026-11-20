import { useEffect, useMemo, useState } from 'react';
import { Brain, Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { memoryStats, useMemoryStore } from '@/store/useMemoryStore';
import { PanelCard } from '@/components/ui/Card';
import { Badge, Button, IconButton, Input, Select, Textarea } from '@/components/ui/primitives';
import { fmtRelative } from '@/components/ui/helpers';
import { LESSON_KIND_LABEL, LESSON_KINDS, LESSON_SOURCE_LABEL, TEAM_MEMORY, type AgentProfile, type Lesson, type LessonKind, type MemorySearchHit } from '@/types';

const KIND_TONE: Record<LessonKind, 'accent' | 'warning' | 'success' | 'neutral'> = {
  convention: 'accent',
  pitfall: 'warning',
  decision: 'success',
  preference: 'accent',
  fact: 'neutral',
};

function LessonItem({ lesson, matchedBy }: { lesson: Lesson; matchedBy?: MemorySearchHit['matchedBy'] }) {
  const update = useMemoryStore((s) => s.update);
  const remove = useMemoryStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <li className="group px-3.5 py-2.5" data-testid="lesson">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge tone={KIND_TONE[lesson.kind]}>{LESSON_KIND_LABEL[lesson.kind]}</Badge>
            {lesson.agentId === TEAM_MEMORY ? <Badge>Team</Badge> : null}
            {lesson.pinned ? <Badge tone="accent"><Pin className="h-3 w-3" /> Pinned</Badge> : null}
            {matchedBy?.map((m) => <Badge key={m} tone="success">{m === 'meaning' ? 'Similar meaning' : 'Keyword match'}</Badge>)}
          </div>
          {editing ? (
            <div className="space-y-1.5">
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Lesson text" maxLength={500} />
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => { setText(lesson.text); setEditing(false); }}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!text.trim() || text.trim() === lesson.text} onClick={() => void act(async () => { await update(lesson.id, { text: text.trim() }); setEditing(false); })}>Save</Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{lesson.text}</p>
          )}
          <p className="truncate text-[11px] text-fg-subtle">
            {LESSON_SOURCE_LABEL[lesson.source]} · {fmtRelative(lesson.createdAt)}
            {lesson.uses ? ` · used ${lesson.uses}×` : ' · not used yet'}
            {lesson.reinforced ? ` · confirmed ${lesson.reinforced}× more` : ''}
          </p>
          {error ? <p className="text-[11.5px] text-danger" role="alert">{error}</p> : null}
        </div>
        {!editing ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton size="sm" icon={lesson.pinned ? PinOff : Pin} label={lesson.pinned ? 'Unpin lesson' : 'Pin lesson (always used)'} onClick={() => void act(() => update(lesson.id, { pinned: !lesson.pinned }))} />
            <IconButton size="sm" icon={Pencil} label="Edit lesson" onClick={() => setEditing(true)} />
            <IconButton size="sm" icon={Trash2} label="Forget lesson" className="hover:text-danger" onClick={() => void act(() => remove(lesson.id))} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function AgentMemory({ agent }: { agent: AgentProfile }) {
  const lessons = useMemoryStore((s) => s.lessons);
  const loaded = useMemoryStore((s) => s.loaded);
  const error = useMemoryStore((s) => s.error);
  const load = useMemoryStore((s) => s.load);
  const add = useMemoryStore((s) => s.add);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<LessonKind>('convention');
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemorySearchHit[] | null>(null);
  const [searchMode, setSearchMode] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const mine = useMemo(
    () => lessons.filter((l) => l.agentId === agent.id).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt),
    [lessons, agent.id]
  );
  const team = useMemo(() => lessons.filter((l) => l.agentId === TEAM_MEMORY).length, [lessons]);
  const stats = memoryStats(lessons, agent.id);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.searchMemory(q, agent.id, 12).then(
        (res) => {
          if (!live) return;
          setHits(res.hits);
          setSearchMode(res.mode === 'hybrid' ? `Keyword and meaning search (${res.embeddingModel})` : 'Keyword search');
        },
        (err) => live && setSearchMode((err as Error).message)
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, agent.id, lessons]);

  const teach = async () => {
    const text = draft.trim();
    if (!text) return;
    setStatus(null);
    try {
      const res = await add([{ agentId: agent.id, kind, text, source: 'user' }]);
      setDraft('');
      setStatus(res.added.length ? `${agent.name} will use this on relevant tasks.` : `${agent.name} already knew that; it was confirmed again.`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <PanelCard
      icon={Brain}
      tint="#9333EA"
      title="Memory"
      hint={stats.count ? `${stats.count} lesson${stats.count === 1 ? '' : 's'} · ${stats.thisWeek} this week` : 'Learns from reviews and runs'}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center" data-testid="memory-stats">
        {[
          ['Lessons', stats.count],
          ['Confirmed again', stats.reinforced],
          ['Used in prompts', stats.uses],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 px-2 py-2">
            <p className="truncate text-[15px] font-semibold tabular-nums">{value}</p>
            <p className="truncate text-[11px] text-fg-subtle">{label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-b border-line px-3.5 py-3">
        <Textarea
          rows={2}
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void teach();
            }
          }}
          placeholder={`Teach ${agent.name} something about this project…`}
          aria-label={`Teach ${agent.name}`}
        />
        <div className="flex items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as LessonKind)} aria-label="Lesson kind" className="w-36">
            {LESSON_KINDS.map((k) => <option key={k} value={k}>{LESSON_KIND_LABEL[k]}</option>)}
          </Select>
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">Ctrl+Enter to save</span>
          <Button size="sm" variant="primary" disabled={!draft.trim() || Boolean(error)} onClick={() => void teach()}>Teach</Button>
        </div>
        {status ? <p className="text-[11.5px] text-fg-muted" role="status">{status}</p> : null}
        {error ? <p className="text-[11.5px] text-danger" role="alert">{error}</p> : null}
      </div>
      {mine.length + team > 0 ? (
        <div className="border-b border-line px-3.5 py-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 focus-within:border-accent">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what it knows…" aria-label="Search memory" className="h-7 border-0 bg-transparent px-0 shadow-none focus:ring-0" />
          </label>
          {hits && searchMode ? <p className="mt-1 truncate text-[11px] text-fg-subtle">{searchMode} · {hits.length} result{hits.length === 1 ? '' : 's'}</p> : null}
        </div>
      ) : null}
      {hits ? (
        hits.length ? (
          <ul className="divide-y divide-line">{hits.map((h) => <LessonItem key={h.lesson.id} lesson={h.lesson} matchedBy={h.matchedBy} />)}</ul>
        ) : (
          <p className="px-3.5 py-3 text-[12px] text-fg-subtle">Nothing it knows matches that.</p>
        )
      ) : mine.length ? (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">{mine.map((l) => <LessonItem key={l.id} lesson={l} />)}</ul>
      ) : (
        <p className="px-3.5 py-3 text-[12px] text-fg-subtle">
          No lessons yet. {agent.name} writes them after runs, from QA and mentor feedback, and from what you teach here or with /remember @{agent.name} in the chat.
        </p>
      )}
      {team ? <p className="border-t border-line px-3.5 py-2 text-[11px] text-fg-subtle">{team} team lesson{team === 1 ? '' : 's'} also apply to {agent.name}.</p> : null}
    </PanelCard>
  );
}

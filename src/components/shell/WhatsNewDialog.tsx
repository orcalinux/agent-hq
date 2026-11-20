import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { desktopApi, statusFrom } from '@/desktop/bridge';
import { parseChangelog, releasesBetween, type Release } from '@/desktop/changelog';
import { RELEASES_URL, fmtSize, useUpdateStore, type NotesMode } from '@/desktop/useUpdate';
import { useAgentStore } from '@/store/useAgentStore';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, Button, Spinner } from '@/components/ui/primitives';
import BUNDLED_CHANGELOG from '../../../CHANGELOG.md?raw';

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Release-note text with **bold**, `code` and links, drawn as elements, never as HTML. */
function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index} className="font-semibold text-fg">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={m.index} className="rounded bg-surface-3 px-1 py-px font-mono text-[11.5px]">{m[2]}</code>);
    else out.push(<a key={m.index} href={m[4]} target="_blank" rel="noreferrer" className="text-accent hover:underline">{m[3]}</a>);
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function ReleaseNotes({ release, pending }: { release: Release; pending?: boolean }) {
  return (
    <section className="space-y-2.5" data-testid="release-notes" data-version={release.version}>
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold tabular-nums">v{release.version}</h3>
        {release.date ? <span className="text-[11.5px] text-fg-subtle">{release.date}</span> : null}
        {pending ? <Badge tone="accent">Not installed yet</Badge> : null}
      </div>
      {release.summary ? <p className="text-[12.5px] leading-relaxed text-fg-muted"><Inline text={release.summary} /></p> : null}
      {release.sections.map((s) => (
        <div key={s.title} className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{s.title}</p>
          <ul className="space-y-1 pl-4 text-[12.5px] leading-relaxed text-fg-muted marker:text-fg-subtle [list-style:disc]">
            {s.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function useReleases(mode: NotesMode | null) {
  const state = useUpdateStore((s) => s.state);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [stand, setStand] = useState(false);
  const current = state?.current ?? __APP_VERSION__;
  const target = mode === 'confirm' ? state?.version : current;
  const from = mode === 'confirm' ? current : mode === 'after' ? state?.updatedFrom : undefined;

  useEffect(() => {
    if (!mode || !target) return;
    let live = true;
    setReleases(null);
    setFailed(false);
    setStand(false);
    const api = desktopApi();
    const load = mode === 'confirm' && api ? api.getChangelog(target) : Promise.resolve(BUNDLED_CHANGELOG);
    void load.then((md) => {
      if (!live) return;
      if (!md) return setFailed(true);
      let list = releasesBetween(parseChangelog(md), from, target);
      if (mode === 'browse') list = list.slice(0, 5);
      if (!list.length && state?.simulated && mode === 'confirm') {
        list = parseChangelog(md).slice(0, 1);
        setStand(true);
      }
      setReleases(list);
    });
    return () => {
      live = false;
    };
  }, [mode, target, from, state?.simulated]);
  return { releases, failed, target, current, stand };
}

/** What changed: before restarting into an update, after one, or from Settings. */
export function WhatsNewDialog() {
  const mode = useUpdateStore((s) => s.notes);
  const close = useUpdateStore((s) => s.closeNotes);
  const install = useUpdateStore((s) => s.install);
  const state = useUpdateStore((s) => s.state);
  const autoRestart = useUpdateStore((s) => s.prefs.autoRestart);
  const busy = useAgentStore((s) => statusFrom(s).busy);
  const running = useAgentStore((s) => statusFrom(s).running);
  const { releases, failed, target, stand } = useReleases(mode);
  const confirm = mode === 'confirm' && state?.status === 'ready';

  const title = confirm ? `Update to v${target}` : `What's new in v${target ?? ''}`;
  const description = confirm
    ? `You have v${state?.current}${state?.size ? ` · ${fmtSize(state.size)} downloaded` : ''}. Restarting takes a few seconds; your projects, chats and settings are kept.`
    : mode === 'after'
      ? `Agent HQ was updated from v${state?.updatedFrom}.`
      : 'The latest releases of Agent HQ.';

  return (
    <Dialog
      open={Boolean(mode)}
      onClose={close}
      title={title}
      description={description}
      width="max-w-xl"
      footer={
        <>
          <a href={target ? `${RELEASES_URL}/tag/v${target}` : RELEASES_URL} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg">
            Release page <ExternalLink className="h-3 w-3" />
          </a>
          {confirm ? (
            <>
              <Button variant="ghost" onClick={close}>Later</Button>
              {running && !autoRestart ? <Button onClick={() => install('idle')}>When agents finish</Button> : null}
              <Button variant="primary" data-autofocus data-testid="update-restart" onClick={() => install('now')}>
                {running ? 'Restart now' : 'Restart to update'}
              </Button>
            </>
          ) : (
            <Button variant="primary" data-autofocus onClick={close}>{mode === 'after' ? 'Got it' : 'Close'}</Button>
          )}
        </>
      }
    >
      <div className="space-y-5 py-1" data-testid="whats-new">
        {confirm && running ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-fg" role="alert">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
            <span>{busy} agent{busy === 1 ? ' is' : 's are'} working. Restarting now stops the run; <span className="font-medium">When agents finish</span> restarts by itself once they are done.</span>
          </div>
        ) : null}
        {stand ? (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">Simulated update: v{target} has no release notes, so the installed version's are shown.</p>
        ) : null}
        {releases === null && !failed ? (
          <div className="flex items-center gap-2 py-6 text-[12.5px] text-fg-muted"><Spinner /> Loading release notes…</div>
        ) : null}
        {failed || (releases && !releases.length) ? (
          <p className="py-4 text-[12.5px] text-fg-muted">
            {failed ? "Couldn't load the release notes. " : 'No release notes for this version. '}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open the releases page</a>
          </p>
        ) : null}
        {releases?.map((r, i) => (
          <Fragment key={r.version}>
            {i ? <div className="h-px bg-line" /> : null}
            <ReleaseNotes release={r} pending={confirm && !stand} />
          </Fragment>
        ))}
      </div>
    </Dialog>
  );
}

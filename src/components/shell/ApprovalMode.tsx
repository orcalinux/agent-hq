import { useState } from 'react';
import { ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { APPROVAL_MODES, approvalModeInfo } from '@/engine/approval';
import type { ApprovalMode } from '@/types';
import { Dialog } from '@/components/ui/Dialog';
import { Button, Select } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';

const RANK: Record<ApprovalMode, number> = { ask: 0, auto: 1, full: 2 };
const ICON = { ask: ShieldCheck, auto: Zap, full: ShieldAlert } as const;

/** Changing to a more permissive mode asks for confirmation; going back to a safer one does not. */
function useApprovalModeChange() {
  const mode = useAgentStore((s) => s.approvalMode);
  const setMode = useAgentStore((s) => s.setApprovalMode);
  const [pending, setPending] = useState<ApprovalMode | null>(null);

  const request = (next: ApprovalMode) => {
    if (next === mode) return;
    if (RANK[next] > RANK[mode]) setPending(next);
    else setMode(next);
  };

  const info = pending ? approvalModeInfo(pending) : null;
  const dialog = (
    <Dialog
      open={Boolean(pending)}
      onClose={() => setPending(null)}
      title={info ? `Turn on ${info.label.toLowerCase()}?` : ''}
      description={info?.description}
      footer={
        <>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button
            variant={pending === 'full' ? 'danger' : 'primary'}
            onClick={() => {
              if (pending) setMode(pending);
              setPending(null);
            }}
          >
            {pending === 'full' ? 'Allow full access' : 'Turn on auto-apply'}
          </Button>
        </>
      }
    >
      <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-fg-muted">
        {pending === 'full' ? <li><span className="text-fg">Agents start working as soon as Sovereign proposes a Build plan.</span> You can still stop a run at any time.</li> : null}
        <li>Files that pass QA review are written into the open project without asking.</li>
        <li>Agents can only write inside the project folder, and terminal commands stay on the allow-list.</li>
        <li>Every auto-applied file is logged and can be undone from the Changes panel.</li>
        <li>A file that two independent tasks both changed is never written automatically; you pick the version.</li>
        <li>Run limits in Settings (cost, tokens, time, calls per agent) still stop a run that goes too far.</li>
        {pending === 'full' ? <li>A run interrupted by closing the app resumes by itself the next time it opens.</li> : null}
      </ul>
    </Dialog>
  );
  return { mode, request, dialog };
}

/** Compact picker for the chat panel. */
export function ApprovalModeSelect({ className }: { className?: string }) {
  const { mode, request, dialog } = useApprovalModeChange();
  return (
    <>
      <Select value={mode} onChange={(e) => request(e.target.value as ApprovalMode)} aria-label="Approval mode" className={className}>
        {APPROVAL_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </Select>
      {dialog}
    </>
  );
}

/** Radio cards for Settings. */
export function ApprovalModeCards() {
  const { mode, request, dialog } = useApprovalModeChange();
  return (
    <div role="radiogroup" aria-label="Approval mode" className="grid gap-2 sm:grid-cols-3">
      {APPROVAL_MODES.map((m) => {
        const Icon = ICON[m.id];
        const selected = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => request(m.id)}
            className={cn(
              'flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors',
              selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-fg">
              <Icon className={cn('h-4 w-4 shrink-0', m.id === 'full' ? 'text-warning' : 'text-accent')} />
              <span className="min-w-0 truncate">{m.label}</span>
            </span>
            <span data-multiline="" className="text-[12px] leading-snug text-fg-muted">{m.description}</span>
          </button>
        );
      })}
      {dialog}
    </div>
  );
}

/** Shows the current mode when it is not the default. */
export function ApprovalModeBadge({ className }: { className?: string }) {
  const mode = useAgentStore((s) => s.approvalMode);
  const setView = useAgentStore((s) => s.setActiveView);
  if (mode === 'ask') return null;
  const info = approvalModeInfo(mode);
  const Icon = ICON[mode];
  return (
    <button
      type="button"
      onClick={() => setView('settings')}
      title={`${info.label}: ${info.description}`}
      data-testid="approval-mode-badge"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        mode === 'full' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent',
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {info.short}
    </button>
  );
}

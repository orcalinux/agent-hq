import type { ApprovalMode, OrchestratorMode, ProposedFileChange } from '@/types';

export interface ApprovalModeInfo {
  id: ApprovalMode;
  label: string;
  short: string;
  description: string;
}

export const APPROVAL_MODES: ApprovalModeInfo[] = [
  {
    id: 'ask',
    label: 'Ask every time',
    short: 'Ask',
    description: 'You approve each plan and apply every file change yourself.',
  },
  {
    id: 'auto',
    label: 'Auto-apply changes',
    short: 'Auto',
    description: 'You approve the plan; file changes that pass QA are written to the project automatically.',
  },
  {
    id: 'full',
    label: 'Full access',
    short: 'Full access',
    description: 'Build requests run at once without plan approval, and changes that pass QA are written automatically.',
  },
];

export function approvalModeInfo(mode: ApprovalMode): ApprovalModeInfo {
  return APPROVAL_MODES.find((m) => m.id === mode) ?? APPROVAL_MODES[0];
}

/** Whether QA-approved file changes are written without the user clicking Apply. */
export function autoAppliesChanges(mode: ApprovalMode): boolean {
  return mode === 'auto' || mode === 'full';
}

/** Whether a proposed plan starts running without the user approving it. Only Build requests run. */
export function autoStartsRuns(mode: ApprovalMode, orchestratorMode: OrchestratorMode): boolean {
  return mode === 'full' && orchestratorMode === 'build';
}

/**
 * Picks the pending changes auto mode should write: one per path, the latest proposal wins.
 * Earlier proposals for the same path are returned as superseded so they are not applied over it.
 */
export function selectAutoApply(changes: ProposedFileChange[]): { apply: ProposedFileChange[]; superseded: ProposedFileChange[] } {
  const pending = changes.filter((c) => c.status === 'pending');
  const latest = new Map<string, ProposedFileChange>();
  for (const change of pending) latest.set(change.path, change);
  const keep = new Set([...latest.values()].map((c) => c.id));
  return {
    apply: pending.filter((c) => keep.has(c.id)),
    superseded: pending.filter((c) => !keep.has(c.id)),
  };
}

/** A change can be undone when it was applied and its previous state is known. */
export function canRevert(change: ProposedFileChange): boolean {
  return change.status === 'applied' && change.previousContent !== undefined;
}

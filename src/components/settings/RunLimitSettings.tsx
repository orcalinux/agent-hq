import { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { Button, Field, Input } from '@/components/ui/primitives';
import { DEFAULT_RUN_LIMITS, normalizeLimit, type RunLimits } from '@/engine/runLimits';

const ROWS: Array<{ key: keyof RunLimits; label: string; unit: string; hint: string; step: string }> = [
  { key: 'maxCostUSD', label: 'Cost per run', unit: 'USD', step: '0.5', hint: 'Only models with a known price add to this. On a subscription CLI the cost is valued at API rates, not billed.' },
  { key: 'maxTokens', label: 'Tokens per run', unit: 'tokens', step: '100000', hint: 'Counts every model, including ones with no known price, so nothing runs unchecked.' },
  { key: 'maxMinutes', label: 'Time per run', unit: 'minutes', step: '5', hint: 'Wall-clock time from the moment the run starts or resumes.' },
  { key: 'maxCallsPerAgent', label: 'Model calls per agent', unit: 'calls', step: '5', hint: 'Loop guard: an agent that keeps calling its model is probably stuck.' },
];

function LimitField({ row }: { row: (typeof ROWS)[number] }) {
  const value = useAgentStore((s) => s.runLimits[row.key]);
  const setRunLimits = useAgentStore((s) => s.setRunLimits);
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => setRunLimits({ [row.key]: normalizeLimit(draft) });
  return (
    <Field label={`${row.label} (${row.unit})`} hint={row.hint}>
      <Input
        type="number"
        min="0"
        step={row.step}
        inputMode="decimal"
        placeholder="No limit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="max-w-48"
      />
    </Field>
  );
}

export function RunLimitSettings() {
  const setRunLimits = useAgentStore((s) => s.setRunLimits);
  return (
    <>
      <p className="text-[12.5px] text-fg-muted">
        A safety brake for each run. At 80% of a limit you get a warning in Activity; at 100% the run stops, unfinished tasks go back to pending, and you can raise the limit and Resume. Leave a field empty for no limit.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROWS.map((row) => (
          <LimitField key={row.key} row={row} />
        ))}
      </div>
      <Button size="sm" onClick={() => setRunLimits(DEFAULT_RUN_LIMITS)}>Restore defaults</Button>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { Button, Field } from '@/components/ui/primitives';
import { NumberInput } from '@/components/ui/NumberInput';
import { DEFAULT_RUN_LIMITS, normalizeLimit, type RunLimits } from '@/engine/runLimits';
import { computeMonthlyUsage, DEFAULT_BUDGET_POLICY } from '@/engine/budgets';

const ROWS: Array<{ key: keyof RunLimits; label: string; unit: string; hint: string; step: string }> = [
  { key: 'maxCostUSD', label: 'Cost per run', unit: 'USD', step: '0.5', hint: 'Only models with a known price add to this. On a subscription CLI the cost is valued at API rates, not billed.' },
  { key: 'maxCostPerAgentUSD', label: 'Cost per agent', unit: 'USD', step: '0.5', hint: 'The most one agent may spend in a run, so a single agent cannot use the whole budget. Leave empty for no per-agent limit.' },
  { key: 'maxTokens', label: 'Tokens per run', unit: 'tokens', step: '100000', hint: 'Counts every model, including ones with no known price, so nothing runs unchecked.' },
  { key: 'maxMinutes', label: 'Time per run', unit: 'minutes', step: '5', hint: 'Wall-clock time from the moment the run starts or resumes.' },
  { key: 'maxCallsPerAgent', label: 'Model calls per agent', unit: 'calls', step: '5', hint: 'Loop guard: an agent that keeps calling its model is probably stuck.' },
];

function LimitField({ row }: { row: (typeof ROWS)[number] }) {
  const value = useAgentStore((s) => s.runLimits[row.key]);
  const setRunLimits = useAgentStore((s) => s.setRunLimits);
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = (next: string) => setRunLimits({ [row.key]: normalizeLimit(next) });
  return (
    <Field label={row.label} hint={row.hint}>
      <NumberInput
        aria-label={`${row.label} (${row.unit})`}
        min={0}
        step={Number(row.step)}
        unit={row.unit}
        placeholder="No limit"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        className="max-w-56"
      />
    </Field>
  );
}

function MonthlyLimitField({
  field,
  label,
  unit,
  step,
  hint,
}: {
  field: 'monthlyCostUSD' | 'monthlyTokens';
  label: string;
  unit: string;
  step: number;
  hint: string;
}) {
  const value = useAgentStore((s) => s.budgetPolicy[field]);
  const setBudgetPolicy = useAgentStore((s) => s.setBudgetPolicy);
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = (next: string) => setBudgetPolicy({ [field]: normalizeLimit(next) });
  return (
    <Field label={label} hint={hint}>
      <NumberInput
        aria-label={`${label} (${unit})`}
        min={0}
        step={step}
        unit={unit}
        placeholder="No limit"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        className="max-w-56"
      />
    </Field>
  );
}

export function RunLimitSettings() {
  const setRunLimits = useAgentStore((s) => s.setRunLimits);
  const budgetPolicy = useAgentStore((s) => s.budgetPolicy);
  const setBudgetPolicy = useAgentStore((s) => s.setBudgetPolicy);
  const runHistory = useAgentStore((s) => s.runHistory);
  const monthly = useMemo(() => computeMonthlyUsage(runHistory), [runHistory]);

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
      <div className="space-y-3 border-t border-line pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12.5px] font-medium text-fg">Monthly budget &amp; quota recovery</p>
          <p className="text-[11.5px] text-fg-muted">
            This month ({monthly.monthKey}): ${monthly.costUSD.toFixed(2)} · {monthly.tokens.toLocaleString('en-US')} tokens ({monthly.runsCount} {monthly.runsCount === 1 ? 'run' : 'runs'})
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MonthlyLimitField
            field="monthlyCostUSD"
            label="Monthly spend cap"
            unit="USD"
            step={5}
            hint="Stops any run once cumulative priced spend this calendar month reaches this cap."
          />
          <MonthlyLimitField
            field="monthlyTokens"
            label="Monthly token cap"
            unit="tokens"
            step={500000}
            hint="Cumulative token cap across all runs in the current calendar month."
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-fg">
          <input
            type="checkbox"
            checked={budgetPolicy.autoResumeOnQuotaReset}
            onChange={(e) => setBudgetPolicy({ autoResumeOnQuotaReset: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-line bg-surface-2 accent-accent"
          />
          <span>
            Auto-resume paused runs when provider quota resets
            <span className="block text-[11.5px] text-fg-muted">Wait until the provider reset window arrives, then automatically resume unfinished tasks.</span>
          </span>
        </label>
      </div>
      <Button
        size="sm"
        onClick={() => {
          setRunLimits(DEFAULT_RUN_LIMITS);
          setBudgetPolicy(DEFAULT_BUDGET_POLICY);
        }}
      >
        Restore defaults
      </Button>
    </>
  );
}

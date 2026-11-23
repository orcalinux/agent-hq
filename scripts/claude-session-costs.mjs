import fs from 'node:fs';
import path from 'node:path';

const directory = process.argv[2];
if (!directory || directory === '--help') {
  console.log('Usage: node scripts/claude-session-costs.mjs CLAUDE_PROJECT_LOG_DIRECTORY\nReads top-level JSONL sessions; prints final provider cost-state records without prompts.');
  process.exit(directory === '--help' ? 0 : 1);
}

const sessions = [];
for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.jsonl')).sort()) {
  const rows = fs.readFileSync(path.join(directory, name), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const costs = rows.filter((entry) => entry.type === 'cost-state');
  const last = costs.at(-1);
  const users = rows.filter((entry) => entry.type === 'user');
  const title = users.some((entry) => typeof entry.message?.content === 'string'
    && entry.message.content.startsWith('Generate a 2-4 word tab name'));
  const assistantModels = new Set(rows.filter((entry) => entry.type === 'assistant')
    .map((entry) => entry.message?.model).filter(Boolean));
  sessions.push({
    session: name.slice(0, -6),
    purpose: title ? 'automatic-tab-title' : 'session',
    assistantModels: [...assistantModels],
    startedAt: last?.startTime ? new Date(last.startTime).toISOString() : null,
    durationMs: last?.totalDuration ?? null,
    reportedCostUSD: last?.totalCostUSD ?? null,
    unknownModelCost: last?.hasUnknownModelCost ?? null,
    modelUsage: last?.modelUsage ?? null,
    costSnapshots: costs.map((entry) => ({
      durationMs: entry.totalDuration, reportedCostUSD: entry.totalCostUSD,
    })),
  });
}
console.log(JSON.stringify({
  basis: 'Final native Claude Code cost-state per top-level session; subscription usage valued at provider rates, not an additional bill.',
  nestedSubagentLogsIncluded: false,
  sessions,
  reportedCostUSD: sessions.reduce((sum, entry) => sum + (entry.reportedCostUSD ?? 0), 0),
  incompleteAccounting: sessions.some((entry) => entry.reportedCostUSD === null || entry.unknownModelCost !== false),
}, null, 2));

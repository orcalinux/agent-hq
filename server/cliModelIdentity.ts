import type { StoredConnection } from './config';

export function reportedClaudeModels(result: { modelUsage?: unknown }): string[] {
  if (!result.modelUsage || typeof result.modelUsage !== 'object' || Array.isArray(result.modelUsage)) return [];
  return Object.keys(result.modelUsage).filter((id) => id.trim() === id && id.length > 0 && id.length <= 200);
}

export function observeCliModels(conn: StoredConnection, cwd: string, model: string, models: string[]): void {
  if (conn.method !== 'cli' || conn.providerId !== 'anthropic' || models.length === 0) return;
  const previous = conn.cliModelObservation?.cwd === cwd ? conn.cliModelObservation.models : {};
  conn.cliModelObservation = { cwd, models: { ...previous, [model.replace(/^cli:/, '')]: models } };
}

export function claudeModelChoices(conn: StoredConnection, cwd: string): Array<[string, string]> {
  const observed = conn.cliModelObservation?.cwd === cwd ? conn.cliModelObservation.models : {};
  const choices: Array<[string, string]> = [
    ['default', 'Claude · automatic (verify to identify model)'],
    ['sonnet', 'Claude Sonnet · alias'],
    ['opus', 'Claude Opus · alias'],
    ['haiku', 'Claude Haiku · alias'],
  ];
  for (const choice of choices) {
    const models = observed[choice[0]];
    if (models?.length) choice[1] = `${models.join(' + ')} · last used (${choice[0] === 'default' ? 'automatic' : choice[0] + ' alias'})`;
  }
  const seen = new Set(choices.map(([id]) => id));
  for (const models of Object.values(observed)) {
    for (const id of models) {
      if (!seen.has(id)) {
        choices.push([id, `${id} · Claude Code`]);
        seen.add(id);
      }
    }
  }
  return choices;
}

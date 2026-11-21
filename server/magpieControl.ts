import { execFile } from 'child_process';
import { findOnPath, magpieEndpoint } from './providers';

/**
 * Agent HQ's bridge to Magpie's own routing. Agent HQ decides which models suit a level; Magpie decides
 * which account serves each request (by quota left, weekly pace, turns or weight) and fails over.
 * Only groups named agenthq-simple, agenthq-standard and agenthq-complex are ever created or removed.
 */

export const MANAGED_GROUPS = ['agenthq-simple', 'agenthq-standard', 'agenthq-complex'] as const;
export const GROUP_ROUTINGS = ['usage', 'pace', 'rotate', 'weight'] as const;
export type GroupRouting = (typeof GROUP_ROUTINGS)[number];

export interface ManagedGroup {
  id: string;
  models: string[];
  routing: GroupRouting;
  weights?: Record<string, number>;
}

export interface QuotaWindow {
  name: string;
  /** Percent of the window still available, 0–100. */
  remaining: number;
  resetsAt?: string;
}

export interface ProviderQuota {
  provider: string;
  name: string;
  kind: string;
  plan?: string;
  windows: QuotaWindow[];
}

const MODEL_ID = /^[A-Za-z0-9._\-/:]+$/;

function headers(): Record<string, string> {
  const key = process.env.MAGPIE_API_KEY?.trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

/** Quota left on each subscription Magpie watches. Account names and emails are left out. */
export function parseQuotas(data: unknown): ProviderQuota[] {
  const rows = (data as { data?: unknown[] })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const r = row as Record<string, unknown>;
    if (typeof r.provider !== 'string') return [];
    const windows = (Array.isArray(r.windows) ? r.windows : []).flatMap((w) => {
      const win = w as Record<string, unknown>;
      const remaining = typeof win.remaining === 'number' ? win.remaining : typeof win.used === 'number' ? 100 - win.used : undefined;
      if (typeof win.name !== 'string' || remaining === undefined || !Number.isFinite(remaining)) return [];
      return [{ name: win.name, remaining: Math.max(0, Math.min(100, Math.round(remaining))), ...(typeof win.resetsAt === 'string' ? { resetsAt: win.resetsAt } : {}) }];
    });
    return [{ provider: r.provider, name: typeof r.name === 'string' ? r.name : r.provider, kind: typeof r.kind === 'string' ? r.kind : 'account', ...(typeof r.plan === 'string' ? { plan: r.plan } : {}), windows }];
  });
}

export async function magpieQuotas(): Promise<ProviderQuota[]> {
  const res = await fetch(`${magpieEndpoint().replace(/\/+$/, '')}/v1/magpie/quotas`, { headers: headers(), signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Magpie answered ${res.status} for quotas.`);
  return parseQuotas(await res.json());
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 20_000, env: { ...process.env, NO_COLOR: '1' } }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().replace(/^magpie:\s*/, '').slice(0, 300)));
      else resolve();
    });
  });
}

function magpieBinary(): string {
  const binary = findOnPath('magpie');
  if (!binary) throw new Error('The magpie command was not found. Install Magpie from Connections → Local tools.');
  return binary;
}

/** The magpie commands that create one group with its routing and weights. */
export function groupCommands(group: ManagedGroup): string[][] {
  if (!(MANAGED_GROUPS as readonly string[]).includes(group.id)) throw new Error(`Not an Agent HQ group: ${group.id}`);
  if (!(GROUP_ROUTINGS as readonly string[]).includes(group.routing)) throw new Error(`Unknown routing: ${group.routing}`);
  const models = group.models.filter((m) => MODEL_ID.test(m));
  if (!models.length) throw new Error(`No Magpie models for ${group.id}.`);
  const cmds = [['group', 'add', group.id, `models=${models.join(',')}`, `routing=${group.routing}`, 'stays=session']];
  const set = ['group', 'set', group.id, 'note=Managed by Agent HQ; changes here are replaced on the next sync'];
  if (group.routing === 'weight' && group.weights) {
    const weights = models.map((m) => `${m}=${Math.max(1, Math.min(1000, Math.round(group.weights![m] ?? 1)))}`);
    set.push(`weight=${weights.join(',')}`);
  }
  cmds.push(set);
  return cmds;
}

export async function syncGroups(groups: ManagedGroup[]): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const binary = magpieBinary();
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const group of groups) {
    try {
      for (const args of groupCommands(group)) await run(binary, args);
      out.push({ id: group.id, ok: true });
    } catch (err) {
      out.push({ id: group.id, ok: false, error: (err as Error).message });
    }
  }
  return out;
}

export async function removeGroups(ids: string[]): Promise<void> {
  const binary = magpieBinary();
  for (const id of ids) {
    if (!(MANAGED_GROUPS as readonly string[]).includes(id)) continue;
    await run(binary, ['group', 'rm', id]).catch(() => undefined);
  }
}

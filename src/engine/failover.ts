import type { AIModelId, ProviderState } from '@/types';
import { providerOfRef } from '@/types';

export const EXHAUSTED_COOLDOWN_MS = 30 * 60 * 1000;

const QUOTA_PATTERNS = [
  /\b429\b/,
  /rate.?limit/i,
  /quota/i,
  /insufficient[_ ]?(funds|credit|quota)/i,
  /credit balance/i,
  /billing/i,
  /usage limit/i,
  /limit reached/i,
  /(?:hit|reached) your .{0,40}limit/i,
  /usage_limit_reached/i,
  /out of (credits|usage)/i,
  /exceeded your (current )?(quota|limit)/i,
  /resource.?exhausted/i,
  /overloaded/i,
];

/** True when an error message looks like exhausted credit, quota or rate limit rather than a bug. */
export function isQuotaError(message: string): boolean {
  return QUOTA_PATTERNS.some((re) => re.test(message));
}

export function quotaResetAt(message: string, now = Date.now()): number | null {
  const relative = message.match(/(?:resets?|retry|try again)\s+(?:after|in)\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/i);
  if (relative) {
    let duration = 0;
    for (const part of relative[1].matchAll(/(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:inutes?|ins?)?|s(?:econds?|ecs?)?)/gi)) {
      duration += Number(part[1]) * ({ h: 3_600_000, m: 60_000, s: 1000 }[part[2][0].toLowerCase()] ?? 0);
    }
    if (duration > 0) return now + duration;
  }
  const absolute = message.match(/(?:resets?|try again)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i);
  if (!absolute) return null;
  let hour = Number(absolute[1]);
  const minute = Number(absolute[2] ?? 0);
  if (minute > 59 || (absolute[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (absolute[3]) hour = hour % 12 + (absolute[3].toLowerCase() === 'pm' ? 12 : 0);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: absolute[4] ?? Intl.DateTimeFormat().resolvedOptions().timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const localTime = (timestamp: number) => {
      const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    };
    const date = new Date(localTime(now));
    for (let day = 0; day < 2; day++) {
      const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + day, hour, minute);
      let candidate = target;
      for (let pass = 0; pass < 3; pass++) candidate += target - localTime(candidate);
      if (candidate > now) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export type ExhaustedMap = Record<string, number>;

export function isProviderExhausted(exhausted: ExhaustedMap, providerId: string | null, now = Date.now()): boolean {
  return Boolean(providerId && exhausted[providerId] && exhausted[providerId] > now);
}

/**
 * Pick a replacement model on a different, non-exhausted, connected provider.
 * Hosted providers come first, local Ollama last (free and always available, but usually weaker).
 */
export function pickFallbackModel(
  providers: ProviderState[],
  exhausted: ExhaustedMap,
  failedRef: AIModelId,
  now = Date.now()
): AIModelId | null {
  const failedProvider = providerOfRef(failedRef);
  const candidates = providers
    .filter((p) => p.connection && p.id !== failedProvider && !isProviderExhausted(exhausted, p.id, now) && p.models.some((model) => model.selectable !== false))
    .sort((a, b) => Number(a.id === 'ollama') - Number(b.id === 'ollama'));
  return candidates[0]?.models.find((model) => model.selectable !== false)?.ref ?? null;
}

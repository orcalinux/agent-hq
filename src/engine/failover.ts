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
  /out of (credits|usage)/i,
  /exceeded your (current )?(quota|limit)/i,
  /resource.?exhausted/i,
  /overloaded/i,
];

/** True when an error message looks like exhausted credit, quota or rate limit rather than a bug. */
export function isQuotaError(message: string): boolean {
  return QUOTA_PATTERNS.some((re) => re.test(message));
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
    .filter((p) => p.connection && p.id !== failedProvider && !isProviderExhausted(exhausted, p.id, now) && p.models.length > 0)
    .sort((a, b) => Number(a.id === 'ollama') - Number(b.id === 'ollama'));
  return candidates[0]?.models[0]?.ref ?? null;
}

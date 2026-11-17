/**
 * Model reference: "<providerId>:<model id>" as returned by the server's model discovery,
 * e.g. "anthropic:claude-sonnet-4-5", "ollama:qwen2.5:7b", "anthropic:cli:default".
 * An empty string means "no model assigned".
 */
export type AIModelId = string;

export type AIProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama';

export type ConnectionMethod = 'api_key' | 'env_key' | 'cli' | 'local_endpoint';

export const CONNECTION_METHOD_LABEL: Record<ConnectionMethod, string> = {
  api_key: 'API key',
  env_key: 'Environment variable',
  cli: 'Signed-in CLI',
  local_endpoint: 'Local endpoint',
};

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  source: 'provider' | 'local' | 'user';
}

export interface ModelInfo {
  ref: AIModelId;
  providerId: AIProviderId;
  id: string;
  name: string;
  via: ConnectionMethod;
  contextWindow?: number;
  capabilities: string[];
  pricing?: ModelPricing;
}

export interface ProviderConnectionInfo {
  method: ConnectionMethod;
  connectedAt: string;
  lastVerifiedAt?: string;
  lastError?: string;
  maskedKey?: string;
  endpointUrl?: string;
  cliBinary?: string;
}

export interface ProviderState {
  id: AIProviderId;
  name: string;
  methods: ConnectionMethod[];
  envVars: string[];
  envKeyPresent: boolean;
  cliBinary?: string;
  defaultEndpoint?: string;
  docsUrl: string;
  notes: string;
  connection: ProviderConnectionInfo | null;
  models: ModelInfo[];
}

export interface CliDetection {
  binary: string;
  detected: boolean;
  path?: string;
  version?: string;
  auth?: { checked: boolean; ok?: boolean; detail?: string };
  executionSupported: boolean;
  purpose: string;
}

export function providerOfRef(ref: AIModelId | undefined): AIProviderId | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  return idx > 0 ? (ref.slice(0, idx) as AIProviderId) : null;
}

export function modelIdOfRef(ref: AIModelId | undefined): string {
  if (!ref) return '';
  const idx = ref.indexOf(':');
  return idx > 0 ? ref.slice(idx + 1) : ref;
}

/** Short human label for a model reference when catalog metadata is unavailable. */
export function shortModelLabel(ref: AIModelId | undefined): string {
  if (!ref) return 'Unassigned';
  const id = modelIdOfRef(ref);
  if (id.startsWith('cli:')) return `${providerOfRef(ref)} CLI · ${id.slice(4)}`;
  return id;
}

/**
 * Cost in USD for a call, or null when pricing is unknown.
 * Pricing is only known when the provider reports it, the model is local, or the user entered it.
 */
export function calculateTokenCostUSD(
  pricing: ModelPricing | undefined,
  promptTokens: number,
  completionTokens: number
): number | null {
  if (!pricing) return null;
  const cost = (promptTokens / 1_000_000) * pricing.inputPerM + (completionTokens / 1_000_000) * pricing.outputPerM;
  return Number(cost.toFixed(6));
}

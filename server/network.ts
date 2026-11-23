const CLOUD_ORIGINS = new Set([
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
]);

function httpUrl(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    throw new Error('Use an http(s) endpoint without credentials or a fragment.');
  }
  return url;
}

function trustedOrigins(): Set<string> {
  return new Set((process.env.AGENT_HQ_ALLOWED_ENDPOINTS || '').split(',').filter((entry) => entry.trim()).map((entry) => {
    const url = httpUrl(entry.trim());
    if (url.pathname !== '/' || url.search) throw new Error('AGENT_HQ_ALLOWED_ENDPOINTS must contain origins only.');
    return url.origin;
  }));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';
}

export function validateEndpoint(value: string): string {
  const url = httpUrl(value);
  if (url.search) throw new Error('Endpoint URLs must not contain a query string.');
  if (!isLoopbackHost(url.hostname) && !trustedOrigins().has(url.origin)) {
    throw new Error('Remote endpoints must be explicitly trusted in AGENT_HQ_ALLOWED_ENDPOINTS (comma-separated http(s) origins).');
  }
  return url.href.replace(/\/+$/, '');
}

export function endpointFromHost(value: string | undefined, fallback: string): string {
  const endpoint = value?.trim() || fallback;
  return validateEndpoint(/^https?:\/\//.test(endpoint) ? endpoint : `http://${endpoint}`);
}

export function checkedRequestUrl(value: string): URL {
  const url = httpUrl(value);
  if (!CLOUD_ORIGINS.has(url.origin) && !isLoopbackHost(url.hostname) && !trustedOrigins().has(url.origin)) {
    throw new Error('The request destination is not an approved provider endpoint.');
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

export async function providerFetch(value: string, init: RequestInit = {}): Promise<Response> {
  const url = checkedRequestUrl(value);
  return fetch(url, { ...init, redirect: 'error' });
}

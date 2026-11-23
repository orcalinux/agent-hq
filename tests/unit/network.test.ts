import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedRequestUrl, endpointFromHost, providerFetch, validateEndpoint } from '../../server/network';

afterEach(() => vi.unstubAllEnvs());

describe('provider endpoint policy', () => {
  it('allows loopback services and official provider origins', () => {
    vi.stubEnv('AGENT_HQ_ALLOWED_ENDPOINTS', '');
    expect(validateEndpoint('http://localhost:3425/')).toBe('http://localhost:3425');
    expect(validateEndpoint('http://[::1]:11434/api/')).toBe('http://[::1]:11434/api');
    expect(checkedRequestUrl('http://localhost:3425/v1/models').hostname).toBe('localhost');
    expect(checkedRequestUrl('https://localhost:3425/v1/models').hostname).toBe('localhost');
    expect(checkedRequestUrl('https://api.anthropic.com/v1/models').origin).toBe('https://api.anthropic.com');
    expect(endpointFromHost('localhost:11434', 'http://127.0.0.1:11434')).toBe('http://localhost:11434');
    expect(endpointFromHost('https://localhost:11434', 'http://127.0.0.1:11434')).toBe('https://localhost:11434');
  });

  it('rejects remote, metadata and misleading destinations before making a request', async () => {
    vi.stubEnv('AGENT_HQ_ALLOWED_ENDPOINTS', '');
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data',
      'http://[::ffff:a9fe:a9fe]/',
      'http://192.168.1.20:11434',
      'https://api.openai.com.attacker.example/v1/models',
      'http://localhost.attacker.example',
      'http://localhost@attacker.example',
      'http://user:password@127.0.0.1:3425',
      'file:///etc/passwd',
      'ftp://127.0.0.1',
      'http://127.0.0.1:3425/#fragment',
    ]) {
      expect(() => validateEndpoint(endpoint), endpoint).toThrow();
      await expect(providerFetch(endpoint), endpoint).rejects.toThrow();
    }
    expect(() => validateEndpoint('http://localhost:3425?target=other')).toThrow(/query/);
  });

  it('requires an exact, explicitly trusted origin for remote services', () => {
    vi.stubEnv('AGENT_HQ_ALLOWED_ENDPOINTS', ' https://models.example:8443, http://192.168.1.20:11434 ');
    expect(validateEndpoint('https://models.example:8443/gateway/')).toBe('https://models.example:8443/gateway');
    expect(checkedRequestUrl('http://192.168.1.20:11434/api/tags').hostname).toBe('192.168.1.20');
    for (const url of ['https://models.example', 'http://models.example:8443', 'https://models.example.attacker.test:8443']) {
      expect(() => checkedRequestUrl(url)).toThrow(/approved/);
    }
    vi.stubEnv('AGENT_HQ_ALLOWED_ENDPOINTS', 'https://models.example/path');
    expect(() => validateEndpoint('https://models.example')).toThrow(/origins only/);
  });

  it('does not follow redirects, even to another reachable local server', async () => {
    let destinationRequests = 0;
    const destination = http.createServer((_req, res) => {
      destinationRequests++;
      res.end('redirect destination');
    });
    const origin = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${(destination.address() as AddressInfo).port}/secret` });
      res.end();
    });
    try {
      await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
      await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
      await expect(providerFetch(`http://127.0.0.1:${(origin.address() as AddressInfo).port}/`, {
        headers: { authorization: 'Bearer test-credential' },
        redirect: 'follow',
      })).rejects.toThrow();
      expect(destinationRequests).toBe(0);
    } finally {
      await Promise.all([origin, destination].map((server) => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      })));
    }
  });
});

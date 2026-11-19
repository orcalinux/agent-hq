import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { magpieEndpoint, parseMagpieModels } from '../../server/providers';

describe('Magpie gateway models', () => {
  it('maps models and routing groups, groups first', () => {
    const models = parseMagpieModels({
      data: [
        { id: 'claude/claude-haiku-4-5', magpie_label: 'Claude Haiku 4.5 · Claude Code', context_length: 200000, modalities: { input: ['text', 'image'] } },
        { id: 'group/smart-coding', magpie_label: 'smart-coding · routing group', context_length: 1000000, supported_parameters: ['tools'] },
        { id: '' },
        { magpie_label: 'no id' },
      ],
    });
    expect(models.map((m) => m.ref)).toEqual(['magpie:group/smart-coding', 'magpie:claude/claude-haiku-4-5']);
    expect(models[0]).toMatchObject({ providerId: 'magpie', name: 'smart-coding · routing group', contextWindow: 1000000, capabilities: ['chat', 'tools'] });
    expect(models[1]).toMatchObject({ contextWindow: 200000, capabilities: ['chat', 'vision'] });
    expect(models[1].pricing).toBeUndefined();
  });

  it('handles an empty answer', () => {
    expect(parseMagpieModels({})).toEqual([]);
  });
});

describe('Magpie gateway address', () => {
  const saved = { gateway: process.env.MAGPIE_GATEWAY, xdg: process.env.XDG_CONFIG_HOME };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-magpie-'));

  afterEach(() => {
    if (saved.gateway === undefined) delete process.env.MAGPIE_GATEWAY;
    else process.env.MAGPIE_GATEWAY = saved.gateway;
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
  });

  it('prefers MAGPIE_GATEWAY', () => {
    process.env.MAGPIE_GATEWAY = '127.0.0.1:9999';
    expect(magpieEndpoint()).toBe('http://127.0.0.1:9999');
  });

  it('reads the address Magpie recorded, and falls back to the default', () => {
    delete process.env.MAGPIE_GATEWAY;
    process.env.XDG_CONFIG_HOME = dir;
    expect(magpieEndpoint()).toBe('http://127.0.0.1:3425');
    fs.mkdirSync(path.join(dir, 'magpie'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'magpie', 'gateway.json'), JSON.stringify({ addr: '127.0.0.1:4000' }));
    expect(magpieEndpoint()).toBe('http://127.0.0.1:4000');
    fs.writeFileSync(path.join(dir, 'magpie', 'gateway.json'), JSON.stringify({ addr: 'evil host/x' }));
    expect(magpieEndpoint()).toBe('http://127.0.0.1:3425');
  });
});

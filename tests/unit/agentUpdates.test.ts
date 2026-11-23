import { describe, expect, it } from 'vitest';
import { cliUpdateMethod, cliVersion, stableUpdateAvailable } from '../../server/agentUpdates';

describe('CLI update detection', () => {
  it('extracts actual versions without assuming an unknown installation is outdated', () => {
    expect(cliVersion('Claude Code 2.1.42')).toBe('2.1.42');
    expect(cliVersion('codex-cli 0.171.0')).toBe('0.171.0');
    expect(cliVersion('unknown')).toBeUndefined();
    expect(stableUpdateAvailable(undefined, '2.1.42')).toBe(false);
    expect(stableUpdateAvailable('0.9.0', '0.10.0')).toBe(true);
    expect(stableUpdateAvailable('0.10.0', '0.9.0')).toBe(false);
    expect(stableUpdateAvailable('0.10.0', '0.10.0')).toBe(false);
    expect(stableUpdateAvailable('0.10.0-beta.1', '0.10.0')).toBe(true);
    expect(stableUpdateAvailable('0.11.0-beta.1', '0.10.0')).toBe(false);
    expect(stableUpdateAvailable('0.10.0', 'malicious; command')).toBe(false);
  });

  it('respects npm, native, Homebrew and application-managed installations', () => {
    expect(cliUpdateMethod('claude', '/opt/lib/node_modules/@anthropic-ai/claude-code/cli.js').command).toBe('npm install -g @anthropic-ai/claude-code@latest');
    expect(cliUpdateMethod('claude', '/home/user/.local/share/claude/versions/2.1.42').command).toBe('claude update');
    expect(cliUpdateMethod('gemini', '/opt/homebrew/Cellar/gemini-cli/0.1.0/bin/gemini').command).toBe('brew upgrade gemini-cli');
    expect(cliUpdateMethod('codex', '/usr/lib/chatgpt/resources/codex').command).toBeNull();
    expect(cliUpdateMethod('gemini', undefined).command).toBe('npm install -g @google/gemini-cli@latest');
  });
});

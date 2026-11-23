import { useEffect, useState } from 'react';
import { RefreshCw, Terminal } from 'lucide-react';
import { api } from '@/api/client';
import { useAgentStore } from '@/store/useAgentStore';
import { Badge, Button, Truncate } from '@/components/ui/primitives';
import { openIntegratedTerminal } from '@/utils/terminalActions';
import type { AgentCliUpdate, AgentCliUpdates } from '@/types/agentUpdates';

export function AgentUpdatesSettings() {
  const running = useAgentStore((state) => state.isLiveRunning);
  const [result, setResult] = useState<AgentCliUpdates | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.agentUpdates());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void check(); }, []);

  const prepare = async (agent: AgentCliUpdate) => {
    if (!agent.command || useAgentStore.getState().isLiveRunning) return;
    setPreparing(true);
    setError('');
    try {
      const { useTerminalStore } = await import('@/store/useTerminalStore');
      const id = await useTerminalStore.getState().create();
      if (!id) throw new Error(useTerminalStore.getState().error || 'Could not create a terminal.');
      await api.terminalInput(id, agent.command);
      openIntegratedTerminal();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="agent-cli-updates">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-medium">Agent CLI updates</h3>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">Checks Claude Code, Codex and Gemini against their stable npm releases. Prepare opens a new terminal with the command; review it and press Enter to run.</p>
        </div>
        <Button size="sm" icon={RefreshCw} loading={busy} onClick={() => void check()}>Check agents</Button>
      </div>
      {result ? (
        <div className="divide-y divide-line">
          {result.agents.map((agent) => (
            <div key={agent.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1 basis-44">
                <Truncate className="text-[12px] font-medium">{agent.name}</Truncate>
                <Truncate className="font-mono text-[11px] text-fg-muted">{agent.installed ? `${agent.current || 'Unknown version'}${agent.latest ? ` → ${agent.latest}` : ''}` : 'Not installed'}</Truncate>
                <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">{agent.error || agent.method}</p>
              </div>
              <Badge tone={agent.error ? 'warning' : agent.available ? 'accent' : 'neutral'}>{agent.error ? 'Could not check' : agent.available ? 'Update available' : !agent.installed ? 'Optional' : !agent.current ? 'Unknown version' : 'No newer stable release'}</Badge>
              {agent.command && !agent.error && (agent.available || !agent.installed) ? (
                <Button size="sm" icon={Terminal} disabled={running || preparing} onClick={() => void prepare(agent)}>Prepare {agent.installed ? 'update' : 'install'}</Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {result ? <p className="text-[11px] text-fg-subtle">Checked {new Date(result.checkedAt).toLocaleString()}. Checks contact the public npm registry; no project files or credentials are sent.</p> : null}
      {running ? <p className="text-[11.5px] text-fg-subtle">Finish or stop the current run before updating an agent.</p> : null}
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

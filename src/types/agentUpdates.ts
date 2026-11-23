export interface AgentCliUpdate {
  id: 'claude' | 'codex' | 'gemini';
  name: string;
  installed: boolean;
  current?: string;
  latest?: string;
  available: boolean;
  command: string | null;
  method: string;
  error?: string;
}

export interface AgentCliUpdates {
  checkedAt: number;
  agents: AgentCliUpdate[];
}

export type ComputerAccess = 'off' | 'read' | 'control';

export interface ComputerStatus {
  access: ComputerAccess;
  installed: boolean;
  running: boolean;
  ready: boolean;
  version?: string;
  error?: string;
  probes?: Array<{ label: string; message: string; status: string }>;
}

export interface ComputerTool {
  name: string;
  description: string;
  kind: 'read' | 'action';
  schema: Record<string, unknown>;
}

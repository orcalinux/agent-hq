export interface InstallGuide {
  id: string;
  name: string;
  /** Command for macOS and Linux, or null when the tool is installed another way. */
  command: string | null;
  windowsCommand?: string | null;
  url: string;
}

export const INSTALL_GUIDES: Record<string, InstallGuide> = {
  claude: { id: 'claude', name: 'Claude Code', command: 'npm i -g @anthropic-ai/claude-code', windowsCommand: 'npm i -g @anthropic-ai/claude-code', url: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { id: 'codex', name: 'Codex CLI', command: 'npm i -g @openai/codex', windowsCommand: 'npm i -g @openai/codex', url: 'https://github.com/openai/codex' },
  gemini: { id: 'gemini', name: 'Gemini CLI', command: 'npm i -g @google/gemini-cli', windowsCommand: 'npm i -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
  ollama: { id: 'ollama', name: 'Ollama', command: 'curl -fsSL https://ollama.com/install.sh | sh', windowsCommand: null, url: 'https://ollama.com/download' },
  magpie: { id: 'magpie', name: 'Magpie', command: 'curl -fsSL https://usemagpie.ai/install.sh | sh', windowsCommand: null, url: 'https://usemagpie.ai' },
};

/** The install command for a tool on this OS, or null when the user should use the download page. */
export function installCommandFor(id: string, platform: NodeJS.Platform): string | null {
  const guide = INSTALL_GUIDES[id];
  if (!guide) return null;
  if (platform === 'win32') return guide.windowsCommand ?? null;
  if (id === 'ollama' && platform === 'darwin') return null;
  return guide.command;
}

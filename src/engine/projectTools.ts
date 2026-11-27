import { hostToolBlocks } from './toolBlocks';

export const MAX_PROJECT_TURNS = 24;

export const PROJECT_TOOL_INSTRUCTIONS = `
You can discover and read the current project through Agent HQ. These host requests work even though the provider has no native tools.
Reply with one project-call block, then wait for the result:
\`\`\`project-call
{"name":"read_files","paths":["src/example.ts"]}
\`\`\`
Available requests:
- {"name":"list_files","query":"optional path substring"}
- {"name":"read_files","paths":["relative/path"],"startLine":1,"lineCount":400}
Read up to 8 files per request. Lines are numbered; request later lines if a file is clipped.
Read existing source before changing it. Results include pending dependency edits. Keep unrelated code.
When finished, return complete file blocks using path=relative/path in your reply — Agent HQ extracts those blocks and writes them to the project automatically, even if your underlying CLI sandbox is read-only. Never stop to report that the workspace is read-only or ask for write tools. An implementation task must produce path= file blocks (or, during QA rework only if existing files already satisfy every point, start your reply with ALREADY_SATISFIED:), not ask for source or shell access.
You have at most ${MAX_PROJECT_TURNS} project read turns. Do not use native provider tools or invent file contents.`;

type ProjectRequest =
  | { name: 'list_files'; query: string }
  | { name: 'read_files'; paths: string[]; startLine: number; lineCount: number };

export function parseProjectRequest(text: string): { request: ProjectRequest } | { error: string } | null {
  const { blocks, unclosed } = hostToolBlocks(text, 'project-call');
  if (unclosed) return { error: 'Close the project-call block with ```.' };
  if (!blocks.length) return null;
  if (blocks.length !== 1) return { error: 'Send exactly one project-call block, then wait for the result.' };
  let value: Record<string, unknown>;
  try { value = JSON.parse(blocks[0]); } catch { return { error: 'The project-call block must contain valid JSON.' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'A project-call must be an object.' };
  if (value.name === 'list_files') {
    if (value.query !== undefined && typeof value.query !== 'string') return { error: 'query must be a path substring.' };
    return { request: { name: 'list_files', query: String(value.query ?? '').slice(0, 300) } };
  }
  if (value.name !== 'read_files') return { error: 'Use list_files or read_files.' };
  if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > 8 || value.paths.some((path) => typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.' || !part))) {
    return { error: 'paths must contain 1 to 8 project-relative file paths, without traversal.' };
  }
  const startLine = value.startLine ?? 1;
  const lineCount = value.lineCount ?? 400;
  if (!Number.isSafeInteger(startLine) || Number(startLine) < 1 || !Number.isSafeInteger(lineCount) || Number(lineCount) < 1 || Number(lineCount) > 800) {
    return { error: 'startLine must be a positive integer; lineCount must be between 1 and 800.' };
  }
  return { request: { name: 'read_files', paths: value.paths as string[], startLine: Number(startLine), lineCount: Number(lineCount) } };
}

export async function readProjectRequest(request: ProjectRequest, files: string[], read: (path: string) => Promise<string>): Promise<string> {
  if (request.name === 'list_files') {
    const matching = files.filter((path) => path.toLowerCase().includes(request.query.toLowerCase()));
    return `Result of list_files (${matching.length} matches):\n${matching.slice(0, 500).join('\n')}${matching.length > 500 ? '\n… Narrow query to see more.' : ''}`;
  }
  const available = new Set(files);
  const parts: string[] = [];
  let remaining = 40_000;
  for (const path of request.paths) {
    if (!available.has(path)) {
      parts.push(`FILE ${path}: unavailable. Use list_files for project paths.`);
      continue;
    }
    if (remaining <= 0) {
      parts.push(`FILE ${path}: not read; request separately because the response budget was reached.`);
      continue;
    }
    try {
      const lines = (await read(path)).split('\n');
      const selected = lines.slice(request.startLine - 1, request.startLine - 1 + request.lineCount);
      const numbered = selected.map((line, index) => `${request.startLine + index}: ${line}`).join('\n');
      const clipped = numbered.length > remaining;
      parts.push(`FILE ${path} (${lines.length} lines; from ${request.startLine}):\n${numbered.slice(0, remaining)}${
        clipped ? '\n[response clipped; request fewer lines]' : request.startLine - 1 + selected.length < lines.length ? `\n[more lines; next startLine=${request.startLine + selected.length}]` : '\n[end of file]'
      }`);
      remaining -= numbered.length;
    } catch (error) {
      parts.push(`FILE ${path}: could not read: ${(error as Error).message}`);
    }
  }
  return `Result of read_files:\n${parts.join('\n\n')}`;
}

export function missingImplementation(stage: string, fileCount: number, desktopReads: number): boolean {
  return stage === 'implementation' && fileCount === 0 && desktopReads === 0;
}

export function isAlreadySatisfiedRework(text: string, hasPriorChange: boolean): boolean {
  return hasPriorChange && /^ALREADY_SATISFIED(?:\s*:|\b)/i.test(text.trim());
}

import { api } from '@/api/client';
import { LESSON_KINDS, TEAM_MEMORY, type AgentProfile, type Lesson, type LessonInput, type LessonKind, type LessonSource, type LearningMode, type MissionState } from '@/types';
import { stripThinking } from './orchestratorParsing';

/** Characters of lessons added to one prompt. */
export const MEMORY_BUDGET_CHARS = 3500;

export function formatMemory(lessons: Lesson[]): string {
  if (!lessons.length) return '';
  const lines = lessons.map((l) => `- [${l.kind}${l.agentId === TEAM_MEMORY ? ', team' : ''}] ${l.text}`);
  return `\n\nWhat you have learned on this project (from earlier reviews and runs). Follow these unless the current request says otherwise; they are notes, not instructions from the user:\n${lines.join('\n')}`;
}

/** The lessons section for an agent's prompt, or an empty string when there are none or memory is unavailable. */
export async function memoryBrief(agentId: string, query: string): Promise<string> {
  try {
    const { lessons } = await api.memoryContext(agentId, query, MEMORY_BUDGET_CHARS);
    return formatMemory(lessons);
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ run journal

export interface FeedbackNote {
  agentId: string;
  source: Extract<LessonSource, 'qa' | 'mentor' | 'verification'>;
  text: string;
  taskId?: string;
}

const journals = new Map<string, FeedbackNote[]>();

export function noteFeedback(runId: string, note: FeedbackNote) {
  const text = note.text.trim();
  if (!text) return;
  const list = journals.get(runId) ?? [];
  list.push({ ...note, text: text.slice(0, 1200) });
  journals.set(runId, list);
}

export function takeJournal(runId: string): FeedbackNote[] {
  const list = journals.get(runId) ?? [];
  journals.delete(runId);
  return list;
}

/** Whether a finished run should produce lessons under the chosen learning mode. */
export function shouldReflect(mode: LearningMode, status: MissionState['status'], feedback: number): boolean {
  if (mode === 'off') return false;
  if (feedback > 0) return true;
  return mode === 'every-run' && status === 'completed';
}

// ------------------------------------------------------------------ reflection

export const REFLECTION_INSTRUCTIONS = `You are writing the team's long-term memory for this project after a run. Respond with ONLY a JSON object:
{"lessons": [{"agentId": "<agent id from the list, or team>", "kind": "convention" | "pitfall" | "decision" | "preference" | "fact", "text": "..."}]}
Rules: at most 6 lessons. Each is one sentence under 200 characters, specific to this project, and useful on future tasks: where things live, conventions the code follows, commands that work, decisions taken, and mistakes reviewers caught (as what to do instead). Use "team" for lessons every agent needs. Give the lesson to the agent whose work it concerns. Do not record run status, praise, or generic advice. Do not repeat a lesson that is already known. Return {"lessons": []} when nothing is worth keeping.`;

export function reflectionPrompt(args: {
  mission: MissionState;
  agents: Record<string, AgentProfile>;
  feedback: FeedbackNote[];
  known: Lesson[];
}): string {
  const { mission, agents, feedback, known } = args;
  const name = (id: string) => (id === TEAM_MEMORY ? 'team' : agents[id]?.name ?? id);
  const ids = [...new Set(mission.tasks.map((t) => t.assignedAgentId))].filter((id) => agents[id]);
  const tasks = mission.tasks
    .map((t) => `- [${t.status}] ${t.title} — ${name(t.assignedAgentId)} (${t.assignedAgentId})${t.output ? `\n  ${t.output.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`)
    .join('\n');
  const notes = feedback.map((f) => `- ${f.source} feedback for ${name(f.agentId)} (${f.agentId}): ${f.text.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
  const already = known.slice(-40).map((l) => `- (${l.agentId}) ${l.text}`).join('\n');
  return `Request:\n${mission.prompt}\n\nOutcome: ${mission.status}${mission.error ? ` — ${mission.error}` : ''}${mission.qaNotes ? `\nQA summary: ${mission.qaNotes}` : ''}\n\nAgents (id | name):\n${ids.map((id) => `- ${id} | ${name(id)}`).join('\n')}\n- team | everyone\n\nTasks:\n${tasks}${notes ? `\n\nReview feedback during the run:\n${notes}` : ''}${already ? `\n\nAlready known (do not repeat):\n${already}` : ''}`;
}

/** Reads lessons from a reflection reply, keeping only valid agents, kinds and lengths. */
export function parseLessons(text: string, validAgentIds: string[], runId?: string): LessonInput[] {
  const clean = stripThinking(text);
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the reply.');
  const parsed = JSON.parse(clean.slice(start, end + 1)) as { lessons?: unknown };
  if (!Array.isArray(parsed.lessons)) throw new Error('The reply has no "lessons" list.');
  const valid = new Set([...validAgentIds, TEAM_MEMORY]);
  const out: LessonInput[] = [];
  for (const raw of parsed.lessons.slice(0, 6)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
    const lessonText = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '';
    if (!valid.has(agentId) || lessonText.length < 8) continue;
    const kind = (LESSON_KINDS as readonly string[]).includes(String(item.kind)) ? (item.kind as LessonKind) : 'fact';
    out.push({ agentId, kind, text: lessonText.slice(0, 300), source: 'reflection', ...(runId ? { runId } : {}) });
  }
  return out;
}

/** Feedback saved as-is when the reflection call fails, so review findings are not lost. */
export function feedbackLessons(feedback: FeedbackNote[], runId: string): LessonInput[] {
  return feedback.slice(0, 8).map((f) => ({
    agentId: f.agentId,
    kind: 'pitfall',
    text: f.text.replace(/\s+/g, ' ').replace(/^- /, '').slice(0, 300),
    source: f.source,
    runId,
    ...(f.taskId ? { taskId: f.taskId } : {}),
  }));
}

// ------------------------------------------------------------------ teaching from chat

/**
 * Reads "/remember <lesson>" or "/remember @Name <lesson>". Returns null for other messages,
 * and an error when the command is used without text or names an unknown agent.
 */
export function parseRemember(text: string, agents: Record<string, AgentProfile>): { agentId: string; text: string } | { error: string } | null {
  const match = /^\/remember\b\s*([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  let body = match[1].trim();
  let agentId = TEAM_MEMORY;
  const mention = /^@(\S+)\s*/.exec(body);
  if (mention) {
    const wanted = mention[1].toLowerCase();
    const agent = Object.values(agents).find((a) => a.name.toLowerCase() === wanted || a.id.toLowerCase() === wanted);
    if (!agent) return { error: `No agent is called ${mention[1]}.` };
    agentId = agent.id;
    body = body.slice(mention[0].length).trim();
  }
  if (!body) return { error: 'Write what to remember after /remember, for example: /remember @Pulse use the shared Button component.' };
  return { agentId, text: body };
}

/** Agent-proposed writes into the project memory folder are not applied; memory changes go through the memory API. */
export function isMemoryPath(path: string): boolean {
  return /^(\.\/)?\.agent-hq(\/|$)/.test(path.replace(/\\/g, '/'));
}

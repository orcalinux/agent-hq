import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { CustomChatCommand, OrchestratorMode } from '@/types';
import { expandCustomCommandTemplate, validateCustomCommandInput } from '@/engine/chatCommands';
import { Badge, Button, Input, Textarea } from '@/components/ui/primitives';

type CommandModeChoice = 'keep' | OrchestratorMode;

const MODE_CHOICES: Array<{ id: CommandModeChoice; label: string }> = [
  { id: 'keep', label: 'Keep current mode' },
  { id: 'ask', label: 'Ask' },
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Build' },
];

const TEMPLATE_TOKENS = [
  { token: '{{input}}', hint: 'Everything typed after the command' },
  { token: '$ARGUMENTS', hint: 'Alias for full command arguments' },
  { token: '$1', hint: 'First argument token' },
  { token: '$2', hint: 'Second argument token' },
  { token: '{{file}}', hint: 'Currently open editor file' },
  { token: '{{project}}', hint: 'Active project folder name' },
];

export function CustomCommandSettings() {
  const customCommands = useAgentStore((s) => s.customCommands);
  const upsertCustomCommand = useAgentStore((s) => s.upsertCustomCommand);
  const removeCustomCommand = useAgentStore((s) => s.removeCustomCommand);
  const root = useWorkspaceStore((s) => s.root);
  const activePath = useWorkspaceStore((s) => s.activePath);

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('');
  const [modeChoice, setModeChoice] = useState<CommandModeChoice>('keep');

  const [nameError, setNameError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const nameEditedRef = useRef(false);
  const templateEditedRef = useRef(false);
  const nameBlurredRef = useRef(false);
  const templateBlurredRef = useRef(false);
  const announceTimerRef = useRef<number | undefined>(undefined);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLTextAreaElement>(null);

  const formHeadingId = useId();
  const nameId = useId();
  const nameHintId = useId();
  const nameErrorId = useId();
  const descId = useId();
  const descHintId = useId();
  const templateId = useId();
  const templateHintId = useId();
  const templateErrorId = useId();
  const modeGroupId = useId();

  useEffect(() => () => window.clearTimeout(announceTimerRef.current), []);

  const projectName = useMemo(
    () => (root || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'agent-hq',
    [root],
  );

  const previewText = useMemo(() => {
    const sampleTemplate = template.trim() || 'Audit {{input}} in {{file}} ({{project}})';
    return expandCustomCommandTemplate(sampleTemplate, 'auth routes', {
      file: activePath || 'src/index.ts',
      project: projectName,
    });
  }, [template, activePath, projectName]);

  const queueAnnouncement = (label: string, error: string) => {
    window.clearTimeout(announceTimerRef.current);
    setAnnouncement('');
    announceTimerRef.current = window.setTimeout(() => {
      setAnnouncement(`${label}: Error: ${error}`);
    }, 500);
  };

  const clearAnnouncement = () => {
    window.clearTimeout(announceTimerRef.current);
    setAnnouncement('');
  };

  const getFieldValidation = (
    nextName: string,
    nextTemplate: string,
  ): { nameError: string | null; templateError: string | null } => {
    const nameCheck = validateCustomCommandInput(
      { name: nextName, description, template: nextTemplate || '__placeholder__', mode: modeChoice === 'keep' ? undefined : modeChoice },
      customCommands,
      editingId,
    );
    const tplCheck = validateCustomCommandInput(
      { name: '__valid_probe__', description, template: nextTemplate, mode: modeChoice === 'keep' ? undefined : modeChoice },
      customCommands,
      editingId,
    );
    return {
      nameError: !nameCheck.ok && nameCheck.field === 'name' ? nameCheck.error : null,
      templateError: !tplCheck.ok && tplCheck.field === 'template' ? tplCheck.error : null,
    };
  };

  const resetForm = () => {
    setEditingId(undefined);
    setName('');
    setDescription('');
    setTemplate('');
    setModeChoice('keep');
    setNameError(null);
    setTemplateError(null);
    nameEditedRef.current = false;
    templateEditedRef.current = false;
    nameBlurredRef.current = false;
    templateBlurredRef.current = false;
    clearAnnouncement();
  };

  const startEdit = (cmd: CustomChatCommand) => {
    setEditingId(cmd.id);
    setName(cmd.name);
    setDescription(cmd.description);
    setTemplate(cmd.template);
    setModeChoice(cmd.mode ?? 'keep');
    setNameError(null);
    setTemplateError(null);
    setStatusMessage(null);
    nameEditedRef.current = false;
    templateEditedRef.current = false;
    nameBlurredRef.current = false;
    templateBlurredRef.current = false;
    clearAnnouncement();
    nameInputRef.current?.focus();
  };

  const handleNameChange = (next: string) => {
    setName(next);
    setStatusMessage(null);
    nameEditedRef.current = true;
    const { nameError: err } = getFieldValidation(next, template);
    if (!err) {
      setNameError(null);
      clearAnnouncement();
    } else if (nameBlurredRef.current) {
      setNameError(err);
    }
  };

  const handleNameBlur = () => {
    nameBlurredRef.current = true;
    if (!nameEditedRef.current) return;
    const { nameError: err } = getFieldValidation(name, template);
    setNameError(err);
    if (err) queueAnnouncement('Command name', err);
  };

  const handleTemplateChange = (next: string) => {
    setTemplate(next);
    setStatusMessage(null);
    templateEditedRef.current = true;
    const { templateError: err } = getFieldValidation(name, next);
    if (!err) {
      setTemplateError(null);
      clearAnnouncement();
    } else if (templateBlurredRef.current) {
      setTemplateError(err);
    }
  };

  const handleTemplateBlur = () => {
    templateBlurredRef.current = true;
    if (!templateEditedRef.current) return;
    const { templateError: err } = getFieldValidation(name, template);
    setTemplateError(err);
    if (err) queueAnnouncement('Prompt template', err);
  };

  const insertToken = (token: string) => {
    const el = templateInputRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    const prefix = start > 0 && !/\s$/u.test(template.slice(0, start)) ? ' ' : '';
    const next = `${template.slice(0, start)}${prefix}${token}${template.slice(end)}`;
    handleTemplateChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + prefix.length + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    const errors = getFieldValidation(name, template);
    setNameError(errors.nameError);
    setTemplateError(errors.templateError);
    if (errors.nameError) {
      nameBlurredRef.current = true;
      nameInputRef.current?.focus();
      return;
    }
    if (errors.templateError) {
      templateBlurredRef.current = true;
      templateInputRef.current?.focus();
      return;
    }
    const result = upsertCustomCommand({
      id: editingId,
      name,
      description,
      template,
      mode: modeChoice === 'keep' ? undefined : modeChoice,
    });
    if (!result.ok) {
      if (result.field === 'name') {
        setNameError(result.error);
        nameInputRef.current?.focus();
      } else {
        setTemplateError(result.error);
        templateInputRef.current?.focus();
      }
      return;
    }
    const actionWord = editingId ? 'Updated' : 'Saved';
    resetForm();
    setStatusMessage(`${actionWord} /${result.command.name}.`);
  };

  const shownNameError = Boolean(nameError);
  const shownTemplateError = Boolean(templateError);

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="sr-only">{announcement}</div>
      <p className="text-[12.5px] text-fg-muted">
        Define reusable <code className="font-mono text-[12px]">/slash</code> templates for Sovereign chat. Custom commands appear in the <code className="font-mono text-[12px]">/</code> menu and cannot override built-in commands or change approvals.
      </p>

      <form
        aria-labelledby={formHeadingId}
        noValidate
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id={formHeadingId} className="text-[12.5px] font-semibold text-fg">
            {editingId ? `Edit /${name || 'command'}` : 'New custom command'}
          </h3>
          {editingId ? (
            <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={nameId} className="block text-[12px] font-medium text-fg-muted">
              Command name <span aria-hidden="true">*</span>
            </label>
            <span id={nameHintId} className="block text-[11px] text-fg-subtle">
              Lowercase letters, numbers, or hyphens (for example <code className="font-mono">audit</code>).
            </span>
            <Input
              ref={nameInputRef}
              id={nameId}
              name="commandName"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="audit"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={shownNameError ? 'true' : 'false'}
              aria-describedby={[nameHintId, shownNameError ? nameErrorId : undefined].filter(Boolean).join(' ')}
              className={shownNameError ? 'border-danger focus:border-danger' : undefined}
            />
            {shownNameError ? (
              <p id={nameErrorId} className="flex items-start gap-1.5 text-[11.5px] text-danger">
                <AlertCircle role="img" aria-label="Error" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{nameError}</span>
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label htmlFor={descId} className="block text-[12px] font-medium text-fg-muted">
              Description
            </label>
            <span id={descHintId} className="block text-[11px] text-fg-subtle">
              Shown next to the command in <code className="font-mono">/</code> autocomplete and <code className="font-mono">/help</code>.
            </span>
            <Input
              id={descId}
              name="commandDescription"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setStatusMessage(null); }}
              placeholder="Security and error-handling review"
              aria-describedby={descHintId}
            />
          </div>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-[12px] font-medium text-fg-muted">Mode when invoked</legend>
          <div className="flex flex-wrap gap-3">
            {MODE_CHOICES.map((choice) => {
              const radioId = `${modeGroupId}-${choice.id}`;
              return (
                <div key={choice.id} className="inline-flex items-center gap-1.5">
                  <input
                    id={radioId}
                    type="radio"
                    name="commandMode"
                    value={choice.id}
                    checked={modeChoice === choice.id}
                    onChange={() => { setModeChoice(choice.id); setStatusMessage(null); }}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <label htmlFor={radioId} className="cursor-pointer text-[12px] text-fg">
                    {choice.label}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor={templateId} className="block text-[12px] font-medium text-fg-muted">
            Prompt template <span aria-hidden="true">*</span>
          </label>
          <span id={templateHintId} className="block text-[11px] text-fg-subtle">
            Variables: <code className="font-mono">{'{{input}}'}</code> / <code className="font-mono">$ARGUMENTS</code> (full text), <code className="font-mono">$1</code>–<code className="font-mono">$9</code> (words), <code className="font-mono">{'{{file}}'}</code> (open file), <code className="font-mono">{'{{project}}'}</code> (workspace name). Trailing text appends automatically if no input placeholder is present.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_TOKENS.map((item) => (
              <button
                key={item.token}
                type="button"
                title={item.hint}
                onClick={() => insertToken(item.token)}
                className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                + {item.token}
              </button>
            ))}
          </div>
          <Textarea
            ref={templateInputRef}
            id={templateId}
            name="commandTemplate"
            value={template}
            onChange={(e) => handleTemplateChange(e.target.value)}
            onBlur={handleTemplateBlur}
            placeholder="Audit {{input}} in {{project}} (focus on {{file}}) for edge cases and missing tests."
            required
            aria-invalid={shownTemplateError ? 'true' : 'false'}
            aria-describedby={[templateHintId, shownTemplateError ? templateErrorId : undefined].filter(Boolean).join(' ')}
            className={shownTemplateError ? 'border-danger focus:border-danger' : undefined}
          />
          {shownTemplateError ? (
            <p id={templateErrorId} className="flex items-start gap-1.5 text-[11.5px] text-danger">
              <AlertCircle role="img" aria-label="Error" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{templateError}</span>
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="text-[11px] font-medium text-fg-subtle">Preview with sample arguments</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-muted">
            {previewText}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <Button type="submit" variant="primary" icon={editingId ? Pencil : Plus}>
            {editingId ? 'Save changes' : 'Add command'}
          </Button>
          {statusMessage ? (
            <p role="status" className="text-[12px] text-success">
              {statusMessage}
            </p>
          ) : null}
        </div>
      </form>

      {customCommands.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
          {customCommands.map((cmd) => (
            <li key={cmd.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Terminal aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  <code className="font-mono text-[12.5px] font-semibold text-fg">/{cmd.name}</code>
                  {cmd.mode ? <Badge tone="accent">{cmd.mode}</Badge> : null}
                  {cmd.description ? <span className="truncate text-[12px] text-fg-muted">{cmd.description}</span> : null}
                </div>
                <p className="truncate font-mono text-[11.5px] text-fg-subtle">{cmd.template}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" size="sm" variant="ghost" icon={Pencil} onClick={() => startEdit(cmd)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`Delete /${cmd.name}`}
                  onClick={() => {
                    if (editingId === cmd.id) resetForm();
                    removeCustomCommand(cmd.id);
                    setStatusMessage(`Deleted /${cmd.name}.`);
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-fg-subtle">
          No custom slash commands saved yet. Add one above to reuse project-specific prompts across chats.
        </p>
      )}
    </div>
  );
}

# Competitive study

A source-level look at seven open-source projects in the same space as Agent HQ, done on 2026-11-22. The goal is to learn what each does well and decide what to build next, **not** to rank products. There are no scores and no "best" claims here, because no head-to-head task benchmark was run.

## How strong the evidence is

Three kinds of evidence are used, and each finding says which one it rests on:

| Kind | Meaning |
| --- | --- |
| **Source** | Read in the repository at the pinned commit. Says what the code and docs describe, not that it works well. |
| **Startup** | The packaged Linux desktop app was launched on an isolated virtual display with an isolated profile. Only the first screens were observed. No model prompt was sent and no paid task was run. |
| **Static** | Selected files of the packaged app were analysed with REA (reverse-engineering tooling). Partial coverage; it shows what is shipped, not how it behaves. |

Competitors' own comparison tables and self-reported scores were not used.

## Projects studied

Star counts are a 2026-11-22 snapshot from the GitHub API. Licenses were checked in each repository's `LICENSE` file, not only the API field.

| Project | Version / commit | License | Stars | Studied by |
| --- | --- | --- | --- | --- |
| Paperclip (`paperclipai/paperclip`) | `be08705` | MIT | ~116k | Source |
| OpenHands (`OpenHands/OpenHands`) | `3e9cf43` | MIT | ~94k | Source |
| MetaGPT (`FoundationAgents/MetaGPT`) | `11cdf46` | MIT | ~71k | Source |
| Paradev, formerly Superset (`ParadevAI/Paradev`) | 2.0.11 / `b79b4ba` | MIT | ~16k | Source, startup log |
| Agent Orchestrator (`OrchestratorInc/agent-orchestrator`) | 0.15.3 / `1f13629` | Apache-2.0 | ~15k | Source, startup, static |
| Maestro (`RunMaestro/Maestro`) | 1.0.4 / `a386772` | **AGPL-3.0** | ~3.6k | Source, startup, static |
| Agent Teams AI (`777genius/agent-teams-ai`) | 2.18.7 / `45315e8` | **AGPL-3.0** | ~2.5k | Source, startup |

Four desktop apps were installed (extracted from their `.deb` packages, no system install, SHA-256 checked against the release metadata). Paperclip, OpenHands and MetaGPT were **source only**: they need Node 24 or a server stack, and installing them was out of scope.

**License rule.** No code from any of these projects is in Agent HQ. The two AGPL projects are design references only; their code must not be copied into an MIT codebase.

## What was observed at startup

- **Maestro** asks for a typography choice before the welcome screen. Observed in the packaged app.
- **Agent Orchestrator** shows Automations, Artifacts, Sessions and Projects, reports its daemon as ready, offers an optional sign-in and a "Get started" welcome.
- **Agent Teams AI** shows a provider list and a team and folder picker. It found pre-existing local CLI session history even with a redirected config directory; the correct override is `AGENT_TEAMS_ELECTRON_CLAUDE_ROOT`. Its captures are not published because they showed private project names.
- **Paradev** loaded its `#/sign-in` page according to its log. Remote debugging was refused, so its UI could not be inspected further. Nothing else is claimed.

These are first-screen observations. None of them says anything about reliability during real work.

## What each project does that Agent HQ could learn from

| Area | Reference (source) | Takeaway |
| --- | --- | --- |
| Governance and budgets | Paperclip: `docs/guides/board-operator/costs-and-budgets.md`, `approvals.md` | Per-agent monthly budgets with 80% alerts and a pause at 100%, plus approve / reject / request-revision flows for hires and strategy. The closest match to Agent HQ's "team of employees" idea. Org charts and reporting lines are **not** unique to Agent HQ. |
| Crash and quota resilience | Maestro: `docs/agent-resilience.md`, `src/main/agent-run/recover-runs.ts` | Retries with backoff, quota-reset handling, cancellation. On restart, runs with no live process are marked failed with an audit event; they are not silently resumed. |
| Terminal survives the UI | Paradev: `apps/desktop/src/main/lib/terminal-host/client.ts` | A separate terminal daemon with reconnect, request timeouts and queue limits, so closing the window does not kill sessions. |
| Isolated workspaces | Agent Orchestrator: `backend/internal/adapters/workspace/gitworktree/`; Maestro: `docs/git-worktrees.md` | One Git worktree per task or worker so parallel agents cannot overwrite each other's files. |
| Restart with pending approval | Agent Orchestrator: `backend/e2e/chat_approval_restart_stub_test.go` | An end-to-end test that an approval request survives a restart. |
| Retry policy | Agent Teams AI: `src/features/team-runtime-recovery/core/domain/RuntimeRecoveryPolicy.ts` | Bounded retries, opt-in defaults, jitter, user cancellation, scheduled retry after a rate-limit reset. |
| Tool approval UI | Agent Teams AI: `ToolApprovalSheet.tsx`, `ToolApprovalDiffPreview.tsx` | Per-action approval with a diff preview. |
| Server separation | OpenHands: `src/api/agent-server-adapter.ts` | An agent server separate from the UI, with an optional per-conversation Docker sandbox. Its default local path can run without a sandbox, so default isolation must not be assumed. |
| Team serialization and cost cap | MetaGPT: `metagpt/team.py` | Teams can be serialized and restored; `cost_manager.max_budget` caps spend. A framework, not a comparable desktop app. |

One naming trap: `backend/internal/ports/spawn_budget.go` in Agent Orchestrator is a request **timeout** budget, not a spending budget.

## Chat commands and mentions (added 2026-11-23)

Evidence kind for every row is **Source** (README or code in the research bundle). Maestro and Agent Teams AI are AGPL-3.0, so they are design references only; no code was copied.

| Project | What its chat offers | Evidence |
| --- | --- | --- |
| OpenHands | Built-in menu commands `/new`, `/btw` (side question), `/model` (list or switch model), `/goal`, `/plan` and `/code` (switch mode) | `src/utils/constants.ts` |
| Maestro | Slash commands with autocomplete and user-defined commands with template variables; `@agent` consults another agent inline as a single-turn background call; `@` for files | `README.md` |
| Agent Teams AI | Slash commands, `#task-id` mentions, `@team-name`, attached code context; a runnable-action command palette is still on its roadmap | `README.md` |
| Agent Orchestrator | Skills act as slash commands only at the start of a message; `@` can follow any whitespace; emails, URLs and paths stay plain text | `packages/mobile/lib/chat/composerSuggestions.ts` |
| Paradev | Slash-command discovery runs host-side and is exposed over RPC | `plans/chat-ui-greenfield-research.md` |
| MetaGPT | Framework without a chat composer; nothing to compare | repository search |
| Paperclip | Not in the local bundle; not re-checked | none |

What Agent HQ took: commands that run real actions (new conversation, mode switch with an optional prompt, run control, navigation), argument completion, and the start-of-message rule for `/`. Safety rule of its own: chat cannot loosen approvals.

Not built yet, and seen in peers: `/model` to switch a model from chat, user-defined commands, `#task` mentions, `@agent` as a one-off consult, and a `/btw` side question.

## What Agent HQ has taken so far (verified 2026-11-23)

Checked against this repository's code and tests, not only the changelog.

| Idea | From | Status | Evidence in this repo |
| --- | --- | --- | --- |
| Run limits with 80% warning and hard stop | Paperclip, MetaGPT | Built (0.15.0) | `src/engine/runLimits.ts`, called from `enforceLimits` in `liveOrchestrator.ts`; `tests/unit/runLimits.test.ts` runs a real run to the limit |
| Cost cap per agent | Paperclip | Built (0.19.0), per run, off by default | same files; a real-run test stops the run on one agent's spend |
| Monthly per-agent budgets that persist across runs | Paperclip | **Not built** | none |
| Retry with backoff for temporary errors | Maestro, Agent Teams AI | Built (0.19.0) | `src/engine/retry.ts`; `tests/e2e/retry.spec.ts` drives the real call path |
| Quota-reset scheduled retry | Agent Teams AI | **Not built**; quota errors reroute to another provider instead | `src/engine/failover.ts` |
| Diff preview and conflict flags | Agent Teams AI, Agent Orchestrator | Built (0.15.0) | `BottomPanel.tsx`; `tests/unit/conflicts.test.ts`, `tests/e2e/safety.spec.ts` |
| Pending approval and finished work survive a crash | Agent Orchestrator | Built (0.15.0) | desktop test that SIGKILLs the app mid-run |
| Terminal that survives the UI | Paradev | **Not built** | none |
| One worktree per task | Agent Orchestrator, Maestro | Not built; agents propose changes instead of writing files | none |
| Chat commands, argument completion, `/` only at message start | OpenHands, Maestro, Agent Orchestrator | Built (0.17.0, 0.18.0) | `src/engine/chatCommands.ts` and its tests |

No code from any studied project is in Agent HQ.

## Where Agent HQ stands today (own source)

Gaps confirmed in this repository, listed so the roadmap is honest:

- **Run ownership.** `src/engine/liveOrchestrator.ts` keeps run controllers in the renderer process. In `src/store/useAgentStore.ts` a running mission that is serialized becomes "cancelled: interrupted by page reload". A `resumeRun` path exists, so resume is partial, not absent.
- **No worktree isolation.** CLI subprocesses run in the project folder (`server/providers.ts`). The scheduler (`src/engine/scheduler.ts`) orders work by agent and dependency, not by which files conflict.
- **No audited hard spending cap.** Cost is tracked per run, but nothing in the inspected paths stops a run at a limit. Unknown pricing is shown as unpriced, never as free.
- **Credentials at rest.** API keys are stored in a JSON file with mode 0600 in a 0700 directory, written atomically and **not encrypted**.
- **Unsigned installers.** Releases are built with signing discovery turned off; the README says so.

## Where Agent HQ is different

These are product choices, not proof of superiority: automatic role-to-model routing across several providers with a local gateway, mentor links for onboarding juniors, a project-scoped memory with retrieval, narrated tutorials built from real recordings, and a desktop app whose layout works down to 640 px wide so OS tiling works.

## Recommendation

Pick strengths by dimension instead of merging whole products: governance from Paperclip's model, resilience from Maestro's docs, isolation from worktree-per-task designs, a terminal host from Paradev's pattern. The ordered plan is in [ROADMAP.md](../ROADMAP.md).

## Reproducing the study

The installs, sources, release metadata and the 282 MB REA evidence bundle are kept **outside Git**, in `~/.local/share/agent-hq-research` on the machine that ran the study. Each app was run with its own config and data directories, never with real credentials. REA records:

- Agent Orchestrator `app.asar`, SHA-256 `2172ddf7…a3dc44`, evidence `ev_c60b2f3a0702938153a200974ee07a02cf74d65c95df846c5845f990d52c4e64`.
- Maestro `app.asar`, SHA-256 `7ee7f5cf…add35de4`, evidence `ev_ad0a710208ca3a032febcdc7aa1297d3635ed66cf37f5cfda8b5e7a3ac937f0e`.

Both analyses covered only selected files (`package.json`, main and preload bundles), so they are partial. The packaged `package.json` of Agent Orchestrator says MIT while the repository root is Apache-2.0; treat the license of that project as Apache-2.0 for the repo and verify per component before reuse.

## Limits of this study

- No real task was run on any competitor, so nothing here compares quality, speed or cost.
- Paradev's UI past sign-in, and all of Paperclip, OpenHands and MetaGPT at runtime, were not observed.
- Stars measure attention, not fitness for your work.

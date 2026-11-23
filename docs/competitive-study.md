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
- **Spending caps are per run only.** `src/engine/runLimits.ts` stops a run at configurable cost, token, time and per-agent call limits (defaults: 10 USD, 5M tokens, 90 min, 60 calls). There is no monthly budget that persists across runs, which Paperclip has. Unknown pricing is shown as unpriced, never as free.
- **Credentials at rest.** API keys are stored in a JSON file with mode 0600 in a 0700 directory, written atomically. Secrets are sealed with AES-256-GCM (`encryptSecret` in `server/config.ts`), with the key protected by the OS credential store through Electron safeStorage.
- **Unsigned installers.** Releases are built with signing discovery turned off; the README says so.

## Where Agent HQ is different

These are product choices, not proof of superiority: automatic role-to-model routing across several providers with a local gateway, mentor links for onboarding juniors, a project-scoped memory with retrieval, narrated tutorials built from real recordings, and a desktop app whose layout works down to 640 px wide so OS tiling works.

## Recommendation

Pick strengths by dimension instead of merging whole products: governance from Paperclip's model, resilience from Maestro's docs, isolation from worktree-per-task designs, a terminal host from Paradev's pattern. The ordered plan is in [ROADMAP.md](../ROADMAP.md).

## Reproducing the study

The installs, sources, release metadata and the 282 MB REA evidence bundle are kept **outside Git**, in `~/.local/share/agent-hq-research` on the machine that ran the study. The initial startup inspection used isolated profiles. The subsequent measured runs below use the user's existing subscription login; profiles and authentication data are not published. REA records:

- Agent Orchestrator `app.asar`, SHA-256 `2172ddf7…a3dc44`, evidence `ev_c60b2f3a0702938153a200974ee07a02cf74d65c95df846c5845f990d52c4e64`.
- Maestro `app.asar`, SHA-256 `7ee7f5cf…add35de4`, evidence `ev_ad0a710208ca3a032febcdc7aa1297d3635ed66cf37f5cfda8b5e7a3ac937f0e`.

Both analyses covered only selected files (`package.json`, main and preload bundles), so they are partial. The packaged `package.json` of Agent Orchestrator says MIT while the repository root is Apache-2.0; treat the license of that project as Apache-2.0 for the repo and verify per component before reuse.

## Limits of this study

- The original study ran no real tasks. The follow-ups below include a Maestro smoke test and graded Tier 2 runs in Maestro and Orchestrator. These are single observations, not enough for a general ranking.
- Paradev's UI past sign-in, and all of Paperclip, OpenHands and MetaGPT at runtime, were not observed.
- Stars measure attention, not fitness for your work.


## Measured results (retained installs)

Added 2026-11-23. Measurements below are observations from this machine, with accounting limitations stated explicitly.

**Setup.** The four desktop competitors stay installed under `~/.local/share/agent-hq-research` with their own profiles. Launch them from the application menu ("... (comparison)") or `launchers/<name>`. Remove them only on request. Paperclip, OpenHands and MetaGPT remain source-only (they need a Node 24 or server stack).

**Task.** `bench/task-template`: fix `slugify()` so five tests pass (punctuation, whitespace collapse, accents, empty result). Same starting commit, same prompt, standard library only.

| Tool | Engine / auth | Wall time | Tokens | Tests | Notes |
|---|---|---|---|---|---|
| Codex CLI 0.167 (preliminary baseline) | Provider/model not verified for that run | 37.2 s | 36,290 reported by CLI | 5/5 pass | Headless `codex exec --sandbox workspace-write`; not a controlled comparison |
| Maestro 1.0.4, build 508ef120 | Codex 0.171.0 → local Magpie → `group/daily-coding` | 40.238 s (Maestro event duration) | 322,920 final Codex session total | 5/5 pass | Dispatched through the running desktop app; tests independently checked with pytest |
| Agent HQ, Agent Orchestrator, Agent Teams AI, Paradev | not run | n/a | n/a | n/a | Pending setup/testing |

These two runs are smoke tests, not a controlled performance comparison: CLI versions, context, and underlying routed models were not matched. A routing-group identifier does not establish the actual upstream model or subscription used. Logged-in CLI status alone also does not establish that a run used subscription authentication.

**Maestro evidence.** Desktop agent `Maestro benchmark — Codex`, tab `ceb0f5f7-0fc8-4ffd-b865-e785ff45a690`, provider session `01a20979-3fb3-71e1-8893-1de132c0869d`. The user prompt was recorded at 17:34:30.307 UTC; the final assistant message at 17:35:08.278 UTC. The isolated task copy is `bench/maestro-codex-01`. Only `slugify.py` changed among the tracked task files; the test file stayed unchanged. Independent verification: `uv run --quiet --with pytest python -m pytest -q test_slugify.py` → 5 passed.

**Accounting limitations.** Maestro's event reports 275,299 input tokens, 683 output tokens, 232,064 cached input tokens, and `cost_usd: 0`. The final Codex session counters instead report 322,172 input tokens (236,032 cached) and 748 output tokens, including 59 reasoning tokens. Cached tokens are included in input, not added again. The discrepancy remains unresolved; zero reported cost does not prove free usage or a measured bill. Actual upstream model, billed cost and subscription quota consumed remain unverified.

**Not yet measured.** No multi-agent, recovery, larger-project or controlled cross-app comparison exists. Maestro's packaged CLI can dispatch to the open desktop app using `MAESTRO_USER_DATA` set to its isolated profile, so manual UI control is not required for each task. Other apps may also expose automation; manual sign-in requirements must be checked individually. Maestro detects Claude Code as available even though the earlier shell PATH check did not locate it.

## Benchmark v2: graded backlog tasks (2026-11-23)

The slugify smoke test above cannot separate anything. A second suite uses a small "tabsplit" expense-sharing codebase (money, splitting, balances, SQLite, HTTP API, CLI) with **hidden acceptance tests** that the agent never sees, and a grader that also checks that the existing tests were left untouched and that only the standard library was used. The suite is held out of this repository on purpose so that agents working in it cannot read the answers.

| Tier | Task | Hidden tests |
|---|---|---|
| 1 | Build the app from a spec | 87 |
| 2 | Six backlog issues on a 1.0 codebase: database migration (all-or-nothing, byte-for-byte rollback), CSV line numbers, performance limits, multi-currency, a negative-cents bug, a tie-break bug | 141 (54 new + 87 regression) |
| 3 | Six independent issues on a 2.0 codebase: exact percentage splits, minimum-payment settle-up (a subset problem where greedy is wrong), edit/delete with an audit log under a "do not change `user_version`, do not touch the file on open" constraint, date recurrence with month-end clamping, a ledger export, and one deliberately vague issue ("add a `settle` command") | 241 (100 new + 141 regression) |

Every tier has a reference solution that scores 100% and a starter that scores well below (16/87, 87/141, 143/241), so the tests are known to be passable and to test something.

### Results (Claude Code, headless, subscription, real runs)

| Model | Tier | Hidden tests | Provider duration | Runner wall time | Turns | API-rate cost |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 1 | 87/87 | 66.1 s | 68.9 s | 8 | $0.30 |
| Sonnet 5.5 | 2 | 141/141 | 152.0 s | 154.5 s | 14 | $0.56 |
| Haiku 5.5 | 2 | 141/141 | 263.7 s | 266.7 s | 20 | $0.12 |
| Haiku 5.5 | 3 | 240/241 | 176.3 s | not retained | 18 | $0.05 |

The only missed test is the vague issue's edge case: `settle` on an unknown group should exit with an error, and the run let the exception escape. Costs are API-rate valuations of subscription usage, not money billed. Earlier versions of this table labelled the provider durations as wall time; the retained runner metadata supplies the corrected wall times above.

### Apps on Tier 2, same task and model (Haiku 5.5, Claude Code engine, same subscription)

| Setup | Hidden tests | Wall time | API-rate cost | Cached input tokens | Output tokens |
|---|---|---|---|---|---|
| Claude Code CLI alone | 141/141 | 266.7 s runner wall | $0.124 | 1.53 M | 62.5 k |
| Agent Orchestrator 0.15.3, one worker session | 141/141 | 256.0 s recorded turn; 264 s polled wall | $0.169 | 2.42 M | 56.1 k |
| Maestro 1.0.4, one agent | 141/141 | 283 s | $0.222 (+79%) | 2.59 M | 61.7 k |
| Agent HQ 0.21.0, adaptive team, all roles pinned to Haiku 5.5 | **86/141 (no project file changed)** | 997.8 s, run marked failed | $0.282 across 22 calls | 1.25 M total tokens | n/a |
| Agent HQ 0.22.1, same setup plus `python -m pytest -q` as verification | **86/141 (no project file changed)** | 1103.9 s, run marked failed | $0.301 across 23 calls | 1.34 M total tokens | n/a |

**Agent HQ result, reported as measured.** The run produced 9 file proposals across 9 completed tasks, then Sentinel (QA) rejected the result twice and the run was marked failed. Every proposal stayed `pending`, so the project directory was unchanged. The 86/141 score is therefore the untouched starter's baseline (82/87 regression tests plus 4 existing), not evidence of Agent HQ's code. Existing tests were untouched. Three causes were observed in the retained call log and code, not guessed: (1) the optional verification command was off in this run, and when set it ran *before* proposals were written, so it could never test the team's work (fixed in 0.22.0); (2) QA is a model reading text and never runs the code, yet it rejected correctly: it found real gaps in the #14 work, including `Expense` missing the new fields; (3) task agents do receive files named in their task text and see upstream proposals, but a task that says "all `tabsplit/*.py`" names no path, so the architect saw only `storage.py`. Proposals were not discarded: they stayed pending in the Changes tab, but nothing reached disk, which is what the grader measures. This is a single sample on one task.

**Agent HQ with verification (0.22.1), reported as measured.** Verification ran on the team's real changes. The first attempt failed on real test errors, the output went back as rework, and the second attempt **passed (167 tests, the team's own)**. Sentinel (QA) then rejected anyway, because those tests do not show the hidden acceptance cases, and a third rework round introduced a collection error. After three rejections the run failed and the last candidate was withdrawn, so the disk was again the untouched starter and the grade is the baseline, not Agent HQ's code. Earlier attempts in the same session each exposed a separate defect that is now fixed (the terminal allowlist refused `python`; a missing `pytest` was reported as the agents' failure; tasks that edited the same file overwrote each other, which produced `cannot import name 'convert_cents'`). Evidence for each is kept. **Still open:** a state that passed real tests is thrown away when a text-only QA model disagrees, and QA cannot run anything itself. This is single samples on one task, so it is not a ranking.

Each run is a single sample, so the timing differences cannot establish a speed ranking. Orchestrator reported adding about 18 KB of system prompt for this session. That is one possible contributor to its usage, not proof of a causal cost difference. These task-level costs do not cover every auxiliary action; the audit below corrects the earlier description of Maestro's title call as small overhead.

**Auxiliary-call audit.** Retained native Claude session logs in the Maestro task directory contain two sessions started together: the Haiku task and a Sonnet prompt beginning “Generate a 2-4 word tab name”. The title session's final `cost-state` reports 467,070 cache-creation input tokens, 16 output tokens, and **$1.868444** at provider rates. The task event reports $0.222286; its final session cost is $0.236935 after additional session activity. The two observed native sessions therefore total **$2.105379**. This is a single measurement in this machine's CLI configuration, not a claim about all Maestro installations or an additional bill.

Orchestrator's conversation records report $0.168508 for the task, and its separate usage event reports $0.000637 for an auxiliary Haiku call: **$0.169145** in these observed records. The bare CLI's final native cost is **$0.123648**. Workflow-level accounting must include auxiliary calls and distinguish final native totals from an app's earlier task event. `scripts/claude-session-costs.mjs` extracts native final cost records without publishing prompts.

**Memory.** Measured as proportional set size (PSS, which does not double-count pages shared between Electron processes) with `smaps_rollup`:

| App | Idle, nothing open | During the Tier 2 run (app plus its agent processes) |
|---|---|---|
| Agent HQ 0.17 (installed) | 124 MB | not measured |
| Maestro 1.0.4 | 195 MB | about 416-452 MB |
| Agent Orchestrator | 199 MB | about 600-630 MB (its own `session top` reports 864 MB RSS for the one session) |

These are historical approximate samples, **not equivalent process-tree measurements**: processes were matched by install path, which can miss CLI descendants. They must not be used to rank memory efficiency. A later complete-tree audit with completed sessions retained measured about 206 MiB PSS for Maestro, 805 MiB for Orchestrator and 188 MiB for the older installed Agent HQ. Orchestrator still held a Claude session process; that is not comparable to a fresh empty app. The new Agent HQ comparison uses the Linux process-tree sampler in `scripts/process-memory.mjs`, including children started by non-main threads. The bare CLI's memory during its earlier run was not measured.

### What this shows, and what it does not

- **The recorded CLI, Maestro and Orchestrator runs saturate Tier 2.** This leaves no room to demonstrate a quality improvement in those samples. It does not prove that every app will pass, that orchestration is useless, or that larger tasks behave the same way.
- The differences still worth measuring include **workflow overhead**, **parallel speed**, **recovery** when a provider runs out of quota mid-run, **isolation** of parallel edits, and **human steps** needed. Independent grading of Agent HQ is essential before claiming parity.
- Maestro and Orchestrator were run through their real CLIs; sign-in was not needed for each task. Agent Teams AI, Paradev and the server-oriented competitors still have no graded result here. Subscription quota exhaustion is recorded rather than silently changing providers.
- A grader bug was found and fixed during this work: it dropped the `*.db` migration fixtures from its scratch copy, which made one run look like it failed 2 of its own tests. Earlier "existing tests" counts for Tier 2 should be disregarded; the hidden-test scores were not affected.

The current method, including the actual Electron/UI driver and safeguards against treating model QA as test execution, is documented in [the desktop comparison protocol](desktop-comparison-protocol.md).

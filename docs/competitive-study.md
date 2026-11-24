# Competitive study

A study of seven open-source projects in the same space as Agent HQ, begun on 2026-11-22. The initial source inspection is followed below by real graded task runs. The goal is to learn what each does well and measure improvements to Agent HQ. Single runs cannot establish an overall product ranking.

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

### Reliability follow-up, November 23

Re-read Maestro's `src/main/agent-run/recover-runs.ts` and Orchestrator's `backend/internal/adapters/workspace/gitworktree/workspace_preserve_test.go`. The useful design lessons are explicit recovery state and independently recoverable written work. No source was copied.

Agent HQ 0.22.2 adds a persisted passing-candidate checkpoint, evidence requirements for QA rejection after passing verification, reverse-order rollback and unique proposal revision IDs. Unique IDs matter because rework previously reused an applied proposal's ID, so a revised write could be skipped. A retained candidate is reverified, carries unresolved QA concerns and does not receive an approval certificate.

The first real 0.22.2 rerun reached verification with files written. Its verification command exceeded five minutes and was terminated, which triggered rework. The shell hosting the benchmark runner was then terminated before the run completed. This is an **interrupted observation with no final grade**, not a passing or failing benchmark result. The partial call logs, memory samples and run state are retained outside Git. Subsequent long runs must use a detached process.

Agent HQ 0.23.0 also adds local project onboarding, CLI version checks and a detached worktree recovery snapshot for each coding task attempt. Worktree tests use real temporary Git repositories and confirm that parallel same-file edits produce separate recoverable copies while leaving the original alone. These snapshots preserve proposed files; agents still use the text proposal protocol, and collective verification still runs through the existing apply/undo flow. Git-ignored dependencies and submodule contents are not copied. Worktrees are not a security sandbox.

Local onboarding verification opens the real built application, clones a public repository through its dialog, stages a real detached worktree, reopens a recent project and checks the layouts at 768, 1000 and 1440 pixels in both themes. It does not submit model calls. This validates those UI flows, not coding quality.

### Context and false-completion follow-up

Two further real runs exposed additional failures. The 0.23.0 Claude attempt
finished failed after 825.0 seconds and 17 calls including learning. It graded
86/141, with no project change retained and the four original tests untouched.
The combined files initially disagreed about storage interfaces; task rework
did not reliably preserve the complete downstream changes.

An initial 0.24.0 Codex attempt, pinned to `gpt-6-sol`, reported completed after
242.9 seconds and made 12 calls including learning. Independent grading was
again **86/141 with no implementation on disk**. This was a false completion:
workers requested source files instead of delivering changes, those answers
were marked completed, and QA accepted the four passing starter tests.
The worker context selector matched paths named in task descriptions, but did
not follow source references inside attached specifications or requests in
dependency output. It could therefore provide the requirements without the
source needed to implement them.

Source inspection of Maestro's
`src/main/process-manager/spawners/ChildProcessSpawner.ts` and Orchestrator's
`backend/internal/adapters/agent/codex/codex.go` confirms that their native
engines launch in the actual task workspace. Their agents can discover files
and run an edit/test loop, rather than depending on a single initial context
selection. Agent HQ keeps its proposal approval boundary, but now exposes
bounded project reads to workers and integration repair, follows specification
and dependency file references, and fails empty implementation answers.
Dependency invalidation, descendant proposal ownership and combined-file
verification repair address the separate integration failure. These are
independent implementations of observed design lessons; no competitor source
was copied.

The Codex group uses fresh clones, the unchanged 141-check hidden suite, pinned
`gpt-6-sol`, medium effort, sequential runs and process-tree memory samples.
Claude and Codex outcomes belong to separate groups; changing engines cannot
establish that an app became better.

### Mentor-revision fix and Agent HQ result (Haiku 5.5)

A fresh 0.24.0 run on `anthropic:cli:claude-haiku-5-5` first ended **failed**
after 232 seconds, not falsely completed. The call log showed the cause: a
junior's correct `format_cents` change and tests were reviewed by a mentor that
cannot run commands or read files. The mentor answered REVISE because the work
was "unverified", and its prose reply replaced the junior's output. That left no
file deliverable, and five dependent tasks were blocked. The fix keeps the
junior's files unless the revision supplies replacement files, and tells the
reviewer what it cannot do.

On a fresh clone of the same starter, the rebuilt app completed in **586 s**
and graded **141/141** on the unchanged hidden suite, with the original tests
untouched. This joins the Haiku group (Claude alone, Orchestrator and Maestro,
all 141/141). Summing the native Claude session's final cost-state once per call
gives $0.1213 across 15 calls, including planning, review and post-run learning.
The sampled process-tree peak was 742 MiB PSS. A repeat on another fresh clone
also completed (617 s) and graded 141/141 with
the original tests untouched, so the result held across two runs. It is still
one task and one model, so it shows that the failure is fixed, not that Agent HQ
is faster or cheaper. The repeat used 17 calls, valued at $0.1353, and peaked at
654 MiB PSS. Native assistant messages in all 32 sessions report
`claude-haiku-5-5`; these calls went directly through Claude Code rather than
Magpie, so their cost source is the native session record, not a gateway
estimate. These figures are API-rate valuations, not additional subscription
charges. Comparable live memory was not captured for the earlier Haiku controls.

The first Orchestrator Codex run was interrupted when the account hit its usage
limit at 22:38 UTC. Its transcript also records three failed edit commands
before that error: `apply_patch` was absent, and two subsequent `git apply`
attempts used invalid patches. Its worktree was unchanged. This is an
interrupted attempt with tool failures, not a completed quality comparison;
quota exhaustion alone does not explain why no files had been written.

### Completed Codex comparison, November 24

The open runs were completed after quota returned. All four setups used
Codex CLI 0.171.0 and `gpt-6-sol` at medium effort for the coding task, with
fresh clones of starter `57f7898aa5a317312f1494be2833c9a0f44c88aa`.
The unchanged task's SHA-256 is
`9659c6388a250083f99c560913ad1c4e1a1940c0dd3dab070db2d05900cb54c0`.
Native session settings and gateway records were audited separately. Model
runs were sequential; the CLI and Maestro runs are from November 23, and the
two new runs are from November 24.

| Setup | New cases | Regression | Wall time | Workflow API-rate value | Sampled peak PSS |
| --- | --- | --- | --- | --- | --- |
| Codex CLI alone | 54/54 | 87/87 | 636.0 s | $1.733 | 720 MiB |
| Maestro, one Codex agent | 54/54 | 87/87 | 497.6 s | $1.633 | 882 MiB |
| Agent Orchestrator, one Codex worker | 54/54 | 87/87 | 777.2 s | $2.477 | 1,526 MiB |
| Agent HQ 0.24.2, adaptive team | 54/54 | 87/87 | 740.2 s | $3.541 | 1,580 MiB |

Every result is **141/141**, preserves the original tests, and introduces no
third-party runtime imports. The archived CLI and Maestro outputs were also
graded again with the same unchanged suite. Agent HQ's two Haiku outputs were
regraded too and both remain 141/141. Machine-readable measurements and
qualifications are in [desktop-tier2-results.json](desktop-tier2-results.json).

**Workflow differences and cost scope.** Agent HQ uses three task slots,
planning, mentor reviews, combined-file verification, QA and learning. Its
operator attaches `SPEC.md` and `ISSUES.md`; native controls discover files
using their own tools. These are different workflows, not identical tool
environments. Agent HQ made 19 host calls that produced 24 gateway requests;
all 24 were served by `gpt-6-sol` at medium effort. Orchestrator's 42 gateway
requests were also served by that model at medium effort. The successful
Orchestrator run still encountered missing `apply_patch`, malformed patches and
a failed completion-report command, then recovered without operator edits.

The Maestro total includes its task, an automatic title call valued at
$0.068423 that was served by `gpt-6.1-sol` at low effort, and a low-effort
`gpt-6-sol` synopsis requested after the coding task completed. Its coding
requests used `gpt-6-sol` at medium effort. Thus its primary model is controlled,
but its auxiliary workflow is not entirely the same model and effort.
Agent HQ's total includes planning, reviews and post-run learning. Completion
times exclude post-run learning and synopsis generation. These are the
gateway's API-rate valuations, not additional subscription charges.

**Memory and timing limits.** Memory is the Linux process-tree PSS sum, sampled
about every two seconds, including model and tool children. It is neither GPU
memory nor a continuous maximum. Maestro and Orchestrator retain previous
sessions; Agent HQ uses a fresh profile. Their initial sampled PSS values were
156, 198 and 366 MiB respectively. The new Orchestrator observer captured its
root throughout; two samples missed short-lived children. Brief update-feed
probes on the same host overlapped the Agent HQ run, but no other benchmark
model run overlapped it. The desktop remained in use: the installed Agent HQ
package was upgraded from 0.19.0 to 0.24.2 at 07:39:29–07:39:36 UTC, during the
Orchestrator run. These differences and the lack of repeated Codex runs prevent
a reliable speed or memory ranking.

The fixes now establish quality parity on this task with both tested engines.
They do not establish that Agent HQ is better than the competitors: on this
Codex sample it took longer and used more API-rate value and sampled memory
than bare Codex and Maestro. Repeated context and engine startup, review cost,
recovery and harder independent tasks remain areas to measure and improve.

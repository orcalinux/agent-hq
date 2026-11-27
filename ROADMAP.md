# Roadmap

What comes next, in priority order, and what "done" means for each item. It follows from the gaps listed in [docs/competitive-study.md](docs/competitive-study.md). Dates are deliberately absent; an item ships when its criteria are met.

## 1. First-run success

Status: **partly done (0.15.0).** `scripts/test-clean-install.sh` installs the real packages in clean Debian 13, Ubuntu 24.04 and Fedora 42 containers and launches the app: all three pass (installing took 54 to 178 s, mostly downloading dependencies; the server answered 1 to 4 s after launch). It already caught a missing ALSA dependency. Not covered: connecting a subscription and finishing a task from a clean install (needs a real sign-in), and a timed end-to-end first task.

A new user installs, connects one subscription and gets a finished task without reading docs.

- Done when: a clean install on Debian/Ubuntu and Fedora reaches a completed task in under five minutes, measured by a scripted run, and every failure on the way shows what to do next.

## 2. Durable runs

Status: **done for crashes and restarts (0.15.0); server-owned execution not done.** A desktop test kills the running app with SIGKILL and, on the next start with a new profile, finished work and a pending approval are intact and the run is marked interrupted. Closing the window hides the app to the tray and the run continues (covered by a desktop test). Interrupted runs are reconciled after a crash, reload or quit (finished tasks kept, in-flight tasks reset, Full access auto-resumes) and quitting mid-run asks first. Decision: moving execution to the server is deferred. `liveOrchestrator.ts` reads and writes about seven UI stores (agents, connections, workspace, memory, Magpie, model watch, limits), so a server-side run would need a headless copy of that core, a large change with a real risk of regressions. Crash and restart safety, which is what the done-criteria ask for, is already covered by the journal. Revisit if headless or background-only use becomes a goal. Run control still lives in the app's renderer process (`liveOrchestrator.ts`), not the server, so runs do not survive the app process exiting, but the active run is now also journaled on the server, so clearing browser data or opening a fresh profile no longer loses it.

Runs are owned by the server, not the window.

- Move run control out of the renderer (`src/engine/liveOrchestrator.ts`) so reloading or closing the window does not cancel work.
- On restart, reconcile every run: resume where safe, otherwise mark it failed with a clear reason and an audit entry.
- Done when: a test kills the app mid-run and the run's state is correct on restart, including a pending approval.

## 3. Isolated workers

Status: **proposal conflict protection, recovery worktrees, plus per-worker worktree verification (0.25.0).** Every coding task attempt keeps a detached Git worktree containing dirty project files and the combined proposals, and when a verification command is configured, `POST /api/workers/verify` runs allow-listed checks directly inside that worker's isolated copy so failures caught in a worker's own changed files trigger one bounded self-repair turn before integration. The main project tree is still updated only through the proposal/apply/verify flow. Real temporary-repository tests verify parallel copies, worktree verification (pass/fail/allowlist/root guards), and conflict reporting. Non-Git or unborn repositories fall back to proposals. Recovery copies are not a security sandbox.

Parallel agents must not overwrite each other.

- One Git worktree per worker, with a controlled merge back and conflict reporting.
- Scheduler aware of file ownership, not just dependencies.
- Done when: two agents editing the same file in parallel produce a reported conflict, never silent data loss.

## 4. Spending and loop limits

Status: **done with cross-run monthly budgets and opt-in quota-reset auto-resume (0.25.0).** Per-run and per-agent caps (with 80% warnings and 100% stops) plus persistent calendar-month spend/token caps and an opt-in automatic resume scheduler when provider quotas reset, in Settings → Run limits and the paused run banner.

- Hard caps per run, per agent, and across runs per calendar month for tokens, cost and wall time, plus a loop guard.
- Models with unknown pricing count against a token cap and are never treated as free.
- Alert at 80%, stop at 100%, and say why.
- Done when: a test run with a tiny cap stops on the cap and reports it.

## 5. Clear approvals

Status: **done (0.15.0).** Diff preview in the Changes tab and an explicit Full access dialog.

- Per-action approval with a diff preview for risky actions.
- Full access states exactly what it allows (writes inside the project, no shell for agents) before it is enabled.

## 6. Evidence, not claims

Status: **real multi-stack comparisons available (Python & TypeScript/Node); broader repeated validation and multi-OS coverage remain open.** `scripts/benchmark.mjs` and [docs/benchmark.md](docs/benchmark.md) run ten real coding tasks across Claude and Codex models.

The harder Tier 3 Python study (`tabsplit` 3.0, 241 hidden checks) compares Agent HQ against bare Codex/Claude CLIs, Paperclip, OpenHands, Maestro, Agent Orchestrator, Agent Teams AI, and MetaGPT on pinned `gpt-6-luna` (`medium`). A second held-out TypeScript/Node multi-module benchmark (`pulsequeue` 2.0, 72 weighted checks across 6 modules) pairs bare Codex CLI vs Agent HQ Desktop (`gpt-6-luna`) and bare Claude Code CLI vs Agent HQ Desktop (`claude-haiku-5-5`, both scoring `72/72` `100.0%`). On Codex `pulsequeue` (`gpt-6-luna`), Agent HQ scored `72/72` on disk via `restorePassingCandidate` (`runHistory.status: "failed"` during a rework round), whereas on Haiku 5.5 Agent HQ finished `completed` in `573.4 s` with `637.5 MiB` peak PSS (`75/75` visible checks). A second operating system, repeated statistical runs per configuration, and live unattended multi-hour quota-reset end-to-end validation remain open. See [the method](docs/desktop-comparison-protocol.md), [retained results](docs/competitive-study.md) and [sanitized run summaries](docs/desktop-tier2-results.json).

- A small public benchmark of real tasks across at least two providers and two operating systems, with the method and raw results published.
- Until it exists, the README makes no "best" or "fastest" claims.

## 7. Trust and distribution

Status: **checksums, private reporting and secret protection enabled; signing remains open.** Release 0.24.7 published installers and checksums; the Linux `.deb` checksum and local installation were verified. API keys are encrypted at rest with AES-256-GCM; the key is sealed with the OS keychain (Electron `safeStorage`) when one is available, with the fallback described in SECURITY.md. Real keyring validation and installer code signing remain open. Repository settings are recorded in [docs/github-administration.md](docs/github-administration.md); the security review is in [docs/security-review.md](docs/security-review.md).

- Signed installers and published checksums.
- A private way to report vulnerabilities (GitHub private reporting is enabled; validate the reporting flow without submitting a fabricated vulnerability).
- Encrypted-at-rest option for stored API keys, using the OS keychain where available.

## Website

Status: **published through GitHub Pages.** `site/` holds the product website (`npm run build:site` writes `site-dist/`) with the version and download button resolved from the latest GitHub release, the quick start, limitations and privacy information. Hosting and deployment are configured; this is no longer a hosting prerequisite. A custom domain and continued documentation/demo maintenance are separate follow-up work. See [docs/website.md](docs/website.md) for the implementation and checks.

- One-line headline, current version and working download links generated from the latest release.
- A short real demo and a five-step quick start.
- Docs, changelog, license (MIT) and privacy statement.
- A truthful limitations section.

## How to help

See [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests against one roadmap item are the easiest to review.

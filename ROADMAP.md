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

Status: **proposal conflict protection plus real recovery worktrees (0.23.0).** Every coding task attempt keeps a detached Git worktree containing dirty project files and the combined proposals. The original project is still changed through the proposal/apply/verify flow; workers do not execute commands inside these copies. Real temporary-repository tests verify that parallel same-file edits have separate retained copies and leave the original unchanged. Non-Git or unborn repositories use proposals. Recovery copies are not a security sandbox. Version 0.24.0 also preserves integration-repair rounds.

Parallel agents must not overwrite each other.

- One Git worktree per worker, with a controlled merge back and conflict reporting.
- Scheduler aware of file ownership, not just dependencies.
- Done when: two agents editing the same file in parallel produce a reported conflict, never silent data loss.

## 4. Spending and loop limits

Status: **done (0.15.0).** Per-run and per-agent caps with 80% warnings, in Settings → Run limits.

- Hard caps per run and per agent for tokens, cost and wall time, plus a loop guard.
- Models with unknown pricing count against a token cap and are never treated as free.
- Alert at 80%, stop at 100%, and say why.
- Done when: a test run with a tiny cap stops on the cap and reports it.

## 5. Clear approvals

Status: **done (0.15.0).** Diff preview in the Changes tab and an explicit Full access dialog.

- Per-action approval with a diff preview for risky actions.
- Full access states exactly what it allows (writes inside the project, no shell for agents) before it is enabled.

## 6. Evidence, not claims

Status: **started (0.15.0).** `scripts/benchmark.mjs` and [docs/benchmark.md](docs/benchmark.md) run ten real coding tasks (four of them harder) across Claude and Codex models. All 80 attempts passed, so the suite still cannot rank models; a harder suite and a second operating system are still needed.

The harder Tier 2 study now includes real CLI, Maestro, Orchestrator and Agent HQ runs. Earlier Agent HQ versions left the starter unchanged and scored 86/141; passing unit tests did not establish coding reliability. After the integration, project-reading and mentor-output fixes, Agent HQ scored 141/141 in two fresh Haiku runs and a fresh Codex run on 0.24.2, preserving the original tests. The same Codex task also scored 141/141 through the CLI, Maestro and Orchestrator. Agent HQ's measured Codex workflow overhead remains higher than the CLI and Maestro, so quality parity on one task is not a best-product claim. Claude and Codex groups remain separate, and a second operating system and broader repeated tasks are still missing. See [the method](docs/desktop-comparison-protocol.md), [retained results](docs/competitive-study.md) and [sanitized run summaries](docs/desktop-tier2-results.json).

- A small public benchmark of real tasks across at least two providers and two operating systems, with the method and raw results published.
- Until it exists, the README makes no "best" or "fastest" claims.

## 7. Trust and distribution

Status: **partly done (0.15.0).** `SECURITY.md` and a `SHA256SUMS.txt` release job exist (the job is untested until the next tag). API keys are now encrypted at rest (AES-256-GCM, key in a separate 0600 file; legacy plain-text configs upgrade on the next save). The key is now sealed with the OS keychain (Electron `safeStorage`) when one is available, with the fallback described in SECURITY.md; this is unit-tested with a stand-in keychain but not yet run against a real keyring (none works on the dev machine). Not done: code signing (needs a certificate) and enabling GitHub private reporting (needs the owner's go-ahead).

- Signed installers and published checksums.
- A private way to report vulnerabilities (GitHub private reporting is currently off; enable and test it before advertising it).
- Encrypted-at-rest option for stored API keys, using the OS keychain where available.

## Website

Status: **built, not published (0.15.0).** `site/` holds a static page (`npm run build:site` writes `site-dist/`) with the version and download button resolved from the latest GitHub release, the quick start, a truthful limitations list and the privacy statement. It was checked in dark, light and mobile widths with no horizontal overflow. Not done: hosting (for example GitHub Pages, which needs the owner's go-ahead), a domain, and a short real demo video on the page. Original scope:

- One-line headline, current version and working download links generated from the latest release.
- A short real demo and a five-step quick start.
- Docs, changelog, license (MIT) and privacy statement.
- A truthful limitations section.

## How to help

See [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests against one roadmap item are the easiest to review.

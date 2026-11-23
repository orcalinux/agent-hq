# Changelog

Every release of Agent HQ is listed here, newest first. Versions follow [Semantic Versioning](https://semver.org): a fix bumps the patch number (0.2.**1**), new features bump the minor number (0.**3**.0).

The version shown in the app (Settings → What's new), the desktop installers and the README badge all come from `package.json`, so a release only needs:

```bash
npm version patch   # or: npm version minor
git push --follow-tags
```

…plus a new section in this file describing what changed.

## [0.22.2] — 2026-11-23

### Fixed
- Rework proposals now have unique revision IDs. Previously a revised file could reuse the ID of an already applied proposal and be skipped during apply.
- A QA rejection after passing verification must identify a proposed file, its task and an exact code excerpt. Unsupported concerns remain visible without discarding the verified files. This is an evidence gate, not proof that passing tests cover every requirement.
- Keep a persisted snapshot of the last candidate that passed verification. When rework fails or exhausts its retries, restore that candidate and run verification again before completing with unresolved QA concerns. These runs do not receive a QA approval certificate.
- Undo verification writes in reverse order, and stop if a file was edited externally. Partial writes or unresolved proposal conflicts cannot be certified by a passing verification command.

## [0.22.1] — 2026-11-23

### Fixed
- **Verification could not run Python projects.** The terminal allowlist refused `python`, and the run then told the agents their code had failed when the command had never started. A command that is refused, or whose test runner is missing (exit 127, `No module named pytest`, `command not found`, a missing npm script), now counts as "could not run": it is logged as a warning, QA is told nothing was tested, and nobody is sent back to rework for it. An import error in the project's own code is still a real failure.

- **Tasks no longer overwrite each other's edits to the same file.** Agents propose whole files, so when three tasks changed `money.py` the last proposal silently dropped the other two tasks' additions, and the project failed to import. Tasks that name the same file now run one after another, and a later task is shown the latest *proposed* version of the file instead of the stale one on disk. Reference files (the attachments, Markdown and text) don't count, so they don't slow tasks down. Found by the benchmark: the verification output pointed at `cannot import name 'convert_cents'`.

### Added
- Test runners on the terminal allowlist: `python -m pytest`, `python -m unittest` (and `python3`), `pytest`, `cargo test|check` and `go test|vet|build`. `python` is allowed only with `-m pytest` or `-m unittest`, so it is not a general interpreter. Arguments must still stay inside the project.

## [0.22.0] — 2026-11-23

### Fixed
- **Verification now tests the team's work, not the old code.** The optional verification command (Settings) used to run before any proposed change was written, so a pass meant nothing and a failure couldn't be traced to the agents. In an auto-apply mode the changes are now written first, the command runs on them, and a failure is undone and sent back as rework. Found by running Agent HQ on a benchmark task: QA reviewed text only, and the run ended with no files changed.
- In manual approval nothing is written until you approve, so the command can't run on the new code. Agent HQ now says so in the activity log instead of silently testing the old files.

### Changed
- **Real test output drives rework.** When verification fails, the end of its output goes to the tasks whose files it names (or to every task that proposed a change when it names none). QA also sees the result of a passing verification, and a QA rejection undoes the changes that were written for the test.
- Rework rounds raised from 1 to 2, because a round now starts from a concrete failure instead of a model's opinion.

### Tests
- Unit tests for choosing which tasks a failing command points at, for recognising a missing test runner, and for the same-file scheduling rule.

## [0.21.0] — 2026-11-23

### Added
- **Clone a repository from the project dialog.** A new "Clone repo" tab takes an https or ssh address, or `owner/repo` for GitHub, and a destination folder, then clones and opens the project. Local paths, `file://`, `ext::`, `git://` and plain `http://` addresses are refused, as is anything that looks like a git option. An existing folder is never overwritten and a failed clone leaves nothing behind.
- **Git and GitHub detection.** The Changes tab now shows the branch, whether it is ahead of or behind its upstream, the GitHub repository (linked), and the last commit. It warns when there is no remote, the branch is not pushed, the repository has no commits, or the GitHub CLI is missing or not signed in. The status bar shows ahead/behind counts.
- Unit tests for remote parsing, clone address validation, repository details (including detached HEAD and empty repositories) and the summary text.

## [0.20.0] — 2026-11-23

### Changed
- **A new product website.** Rebuilt the GitHub Pages site with a larger editorial introduction, an animated illustration of agent delegation, an interactive tour of real Workspace, Tasks, Office and Growth screens, a four-step workflow, and clear explanations of permissions and project memory.
- **Downloads for your system.** Separate Linux packages, Apple silicon and Intel macOS installers, and Windows downloads resolve against the latest published GitHub release. Missing builds or failed lookups fall back to the release page. Checksums and setup instructions stay close to the downloads.

### Added
- Keyboard navigation for the product tour, an expandable screenshot viewer, a mobile navigation menu, accessible FAQ disclosures, and motion pause and reduced-motion support. The site uses no additional runtime dependencies, cookies or analytics.
- A website regression suite covering eight viewport sizes, keyboard interactions, release asset resolution, unavailable release data, reduced motion and browsing without JavaScript. Run it with `npm run test:site`; see `docs/website.md`.

## [0.19.2] — 2026-11-23

### Changed
- Removed the Magpie design-inspiration entry from About → Credits. The existing technology credits remain.

## [0.19.1] — 2026-11-23

### Fixed
- **Restart to update did nothing on Linux.** Installing a downloaded `.deb` ran the administrator step in a way that froze the whole app while it waited for a prompt that might never appear, so the button seemed dead and opening Agent HQ again found the frozen copy. The install now runs in the background and never blocks the app, and it no longer installs silently when you quit.
- When an install does not happen (prompt cancelled, no polkit agent running, missing `pkexec`), the update dialog stays open, says why, offers **Try again**, and shows the command to run by hand with a Copy button. Agent HQ keeps running its current version.
- Opening Agent HQ again always brings up a window, even if the first one was closed.

## [0.19.0] — 2026-11-23

### Added
- **Retry with backoff.** A model call that fails with a temporary error (HTTP 500, 502, 503 or 504, a dropped connection, a timeout) is retried up to twice, after about 1 s and 2 s with random jitter, before the task fails. Each retry is logged in Activity, and pressing Stop cancels the wait immediately. Quota, rate-limit, authentication and bad-request errors are never retried; quota errors still switch to another connected provider.
- **Cost per agent limit** (Settings → Run limits). The most one agent may spend in a run. It warns at 80%, stops the run at 100% naming the agent, and leaves unfinished tasks pending for Resume. It is off by default, so existing runs behave as before, and settings saved by older versions load unchanged.

### Notes
- Both ideas come from the open-source projects in `docs/competitive-study.md` (Paperclip budgets; Maestro and Agent Teams AI retry policy). No code was copied.

## [0.18.2] — 2026-11-23

### Fixed
- **Quota left was stale.** It was read once when Settings opened and cached for 2 minutes, so Codex could show 7% left when Magpie already reported 0%. It now refreshes every 15 seconds while the panel is open and again when the window regains focus.
- Before Sovereign makes a plan, quotas are read fresh, so routing never uses an old number. A forced refresh no longer reuses an answer that was already in flight.
- When a refresh fails, the last reading stays visible but is labelled "Could not refresh · last reading …" with a warning, instead of looking current.

### Added
- The quota panel shows **Live · updated …** and a **Refresh** button. A subscription Magpie has not read for over 10 minutes gets a "stale" badge.

## [0.18.1] — 2026-11-23

### Fixed
- The attach-file popover in the chat (paperclip) stayed open until you clicked the paperclip again. It now closes on a click anywhere outside it, on **Escape** from anywhere, and when focus leaves it.

## [0.18.0] — 2026-11-23

### Added
- **Chat commands that do things.** Type `/` in the chat to pick from `/help`, `/status`, `/clear` (alias `/new`), `/ask`, `/plan`, `/build`, `/approval`, `/team`, `/stop`, `/resume`, `/open` and `/remember`. `/plan`, `/ask` and `/build` switch Sovereign's mode, and any text after them is sent in that mode, for example `/plan add a login page`.
- **Argument completion.** After `/approval`, `/team` or `/open`, the menu lists the valid options, so there is nothing to memorise. **Tab** or **Enter** inserts, **Escape** closes.
- Commands that need no model (`/help`, `/status`, `/stop`, `/clear` and the others) work even before a model is picked.

### Safety
- `/approval` can only make approvals stricter. Loosening them (to `auto` or `full`) still needs the confirmation dialog in the approval picker.

### Notes
- `docs/competitive-study.md` has a new section on what the studied open-source projects offer in chat, with the evidence kind for each finding. No code was copied.

## [0.17.0] — 2026-11-23

### Added
- Chat suggestions for supported slash commands and the current agent roster. Type `/` to discover `/remember`, or `@` to find an agent by name, title or ID. Choose with ↑/↓ and insert with Tab, Enter or a click; Escape dismisses the menu. Completing text never sends a message.
- Suggestions follow the cursor, replace only the current token and preserve the rest of the draft. Multiword and duplicate names insert unique references compatible with the memory command. Selected text, multiline editing and IME composition keep their editing behaviour.
- The themed suggestion menu appears above the composer, outside clipping containers, and repositions on resize. It includes keyboard hints and screen-reader announcements while focus stays in the message input.

## [0.16.4] — 2026-11-23

### Changed
- Number fields in Settings → Run limits no longer use the browser's basic spinner. They now have a themed stepper with − and + buttons, press-and-hold to repeat, ↑ and ↓ keys, an inline unit label, and a floor at zero. Typing is limited to numbers, values commit as you step, and screen readers still hear a spin button with its current value.

## [0.16.3] — 2026-11-23

### Fixed
- The About window on Linux and Windows showed a broken icon and empty Credits and License. It is now an in-app dialog with the Agent HQ logo, version, links, open-source credits and the full MIT license, themed like the rest of the app. The Help menu and the application menu both open it; macOS keeps its native About panel.

## [0.16.2] — 2026-11-23

Includes the themed desktop menus, immediate update checks and updater repair introduced in 0.16.0.

### Fixed
- Collect all platform installers in one publishing job instead of letting parallel builders select or create separate draft releases. Verify the full installer and updater metadata set, generate checksums for every installer and publish once after upload completes.

## [0.16.1] — 2026-11-23

### Fixed
- Windows installer builds: limit Unix file-mode assertions to Unix platforms. The encryption, persistence and run-journal tests continue running on Windows.
- Keep new releases in draft until Linux, Windows and macOS installers, updater metadata, release notes and checksums have all completed. A failed platform build no longer exposes an incomplete stable update.

## [0.16.0] — 2026-11-23

### Added
- **Check for updates whenever you want.** A permanent title-bar action and a pinned application-menu action check immediately, independently of the automatic schedule. An in-app update window shows checking, current version, errors with retry, download progress and the option to review release notes before restarting.

### Changed
- **Themed desktop menu.** File, Edit, View, Window and Help now open in a compact, scrollable panel with consistent icons, shortcut hints, focus states and the app's shared opening/closing motion. Nested menus stay within the panel instead of spilling outside narrow windows. Arrow keys, Home/End, typing to select, Escape and focus restoration are supported. Native menus and shortcuts remain available, including the macOS menu bar.
- Manual update checks from the native Help menu use the same in-app update window instead of operating-system message boxes.

### Fixed
- Load the real updater through the package's CommonJS default export. Installed builds could otherwise fail a real update check with an undefined updater even though simulated checks worked.
- Preserve focus and background modality when moving between update status and release notes. Title-bar status yields space to update and window controls at narrow widths.

## [0.15.2] — 2026-11-23

### Fixed
- Preserve the configured `localhost` hostname during provider requests so HTTPS certificate verification and IPv6-only local services keep working. The destination allowlist and redirect protection remain enforced.

## [0.15.1] — 2026-11-23

### Added
- **GitHub administration guide** ([docs/github-administration.md](docs/github-administration.md)): saved repository identity, branch rules, security settings, workflow permissions, Pages setup, read-only verification commands and maintenance/release checklists. Distinguishes API-verified settings from settings recorded in setup screenshots.
- **Security review record** ([docs/security-review.md](docs/security-review.md)): alert-by-alert fixes, test results and documented false-positive reviews.

### Security
- Upgrade Vitest and its mocker to 4.1.12, removing Tinypool, and override affected Minimatch versions used by desktop packaging with 11.0.9.
- Validate all provider and embedding HTTP destinations centrally and refuse redirects. Local services work by default; remote Ollama and Magpie origins require explicit trust through `AGENT_HQ_ALLOWED_ENDPOINTS`. Embedded URL credentials and fragments are rejected.
- Resolve provider CLI executables from the supported provider list rather than stored executable overrides. Command execution uses the allowlisted program, explicit shell-free spawning and finite timeouts bounded to 1–600 seconds.
- Quote configured shell paths literally when reopening a terminal after installation; reject inherited property names as installer IDs.
- Match release-note versions as literal text instead of inserting command-line input into a regular expression.

## [0.15.0] — 2026-11-22

### Added
- **Run limits.** Every run has hard caps per run and per agent: cost ($10), tokens (5M), wall time (90 min) and model calls (60 per agent). You get a warning at 80% and the run stops at 100% with the reason logged; stopped tasks return to pending. Models with unknown pricing count against the token cap and are never treated as free. Change the caps in **Settings → Run limits**.
- **Conflict detection.** Agents propose changes instead of writing to disk, so two agents proposing the same file are now flagged with a "conflict" badge in the Changes tab. Auto-apply skips conflicted paths and manual apply discards the rival proposals, so nothing is lost silently.
- **Diff preview.** Each proposed change shows a line diff against the file on disk with +/− counts. The Full access dialog now lists exactly what it allows.
- **Interrupted-run recovery.** If the app closes mid-run, finished tasks are kept, in-flight tasks go back to pending and the mission is marked interrupted. In Full access the run resumes automatically on start. Quitting while a run is active asks for confirmation.
- **Server-side run journal.** The active run is mirrored to a per-project file in the config folder (`runs/`, mode 0600). If browser storage is cleared or the profile is new, an unfinished run is restored from it with mid-flight tasks reset to pending. Finished or dismissed runs are not brought back. A desktop test kills the app with SIGKILL mid-run and checks that finished work and a pending approval survive the restart.
- **Benchmark harness** (`scripts/benchmark.mjs`, [docs/benchmark.md](docs/benchmark.md)): ten real coding tasks run against any OpenAI-compatible endpoint with hidden tests. First results: four Claude and Codex models passed all 80 attempts, so it is a connection smoke test, not a ranking.
- **Clean-install test** (`scripts/test-clean-install.sh`, `npm run test:install`): installs the built `.deb`/`.rpm` in a fresh Debian 13, Ubuntu 24.04 or Fedora 42 container, launches the app on a virtual display and checks that its server answers and serves the UI.
- **Project website source** (`site/`, `npm run build:site`): a static, dependency-free page with a live download button, quick start and limitations. Built locally only; it is not published anywhere yet.
- **`SECURITY.md`** and a `SHA256SUMS.txt` file published with each release so downloads can be verified.
- **API keys encrypted at rest.** Stored keys are AES-256-GCM encrypted with a random key kept in a separate `0600` file; existing plain-text configs are upgraded the next time the config is saved. This protects a config file that is copied or shared on its own. When the desktop app finds a usable system keychain, the key file is also sealed by it; otherwise it falls back to the plain key file. If a sealed key cannot be read, saving is refused instead of dropping your keys.

### Fixed
- **Clean Debian install failed to launch.** The `.deb` did not depend on the ALSA library (`libasound2`), so on a fresh Debian 13 the app could not start. The `.deb` now depends on `libasound2t64 | libasound2` and the `.rpm` on `alsa-lib`. Found by the new clean-install test.

### Changed
- Agent graph layout and narrow-window fixes from 0.14.2 are now covered by unit and end-to-end tests.

## [0.14.2] — 2026-11-22

### Fixed
- **Desktop tiling.** Lowered the minimum window size from 1024×640 to 640×360 so operating-system tiling shortcuts can place the app beside another window or above/below it. Your desktop's configured shortcuts are used; Agent HQ does not register its own tiling keys. Saved tiled sizes are preserved on restart.
- **Agent graph never overlaps cards.** A crowded tier now wraps onto extra rows instead of shrinking cards on top of each other, and the canvas grows to fit any team size. A dragged or saved card that would land on another moves to the nearest free spot, and the other cards stay put. Covered by unit tests up to 350 agents and an end-to-end check at two window sizes.
- **Narrow windows.** Below 800 px of workspace width the Code/Chat switch shows one main surface at a time instead of squeezing both, which removed a 46 px horizontal overflow at 640 px. The chat composer stays mounted so an unsent draft survives switching, and Ctrl/Cmd+L switches to Chat before focusing it. The bottom panel is capped at 55% of the height so short tiled windows keep an editor.

### Added
- **MIT license.** Added `LICENSE`, the `license` field in `package.json`, a README badge and `CONTRIBUTING.md`.
- **Competitive study** ([docs/competitive-study.md](docs/competitive-study.md)) and **[ROADMAP.md](ROADMAP.md)**: seven open-source projects reviewed from source, with what was and was not verified.
- `npm run test:tiling`: runs the real window manager on isolated 1920×1080 and 1280×800 displays with custom Ctrl+Alt tiling shortcuts, so tiling is verified with non-Super keys.

## [0.14.1] — 2026-11-22

### Fixed
- **Sharp videos.** The tutorials were captured at 1440×810 and upscaled, because Chromium's screencast ignores the page's device scale. Recordings now start Chromium at 2× and capture true 2880×1620 frames (the recorder refuses smaller ones), every video renders as a 4K master, and the 1080p file is supersampled from it at a higher bitrate. 4K versions (`*.4k.mp4`) are included.

## [0.14.0] — 2026-11-22

### Added
- **Tutorial video series.** The single walkthrough is replaced by six recorded tutorials, one per scenario: setup, manual mode (approve, apply, undo, discard), auto-apply and Full access, models and routing, a growing team (interns, mentors, lessons), and the workspace tools (explorer, editor, palette, terminal). Each is a real recording of the built app with narration, captions, a step bar, a guided camera and a visible pointer. Model replies are scripted, so making the videos uses no credit; file writes, git and the terminal are real.
- **`npm run demo -- <id>`** builds one video (`overview` or a tutorial id) instead of the whole series.

### Changed
- **Overview video.** The narrated explainer is now `00-overview.mp4`; the recorded chapter moved into the tutorials.

### Fixed
- **Files written by agents keep their final newline.** Proposed files no longer lose the last line break, so diffs stop showing "No newline at end of file" and applied files match what the agent wrote.
- **Overview team cards.** Long role descriptions stay inside the card instead of overflowing it.
- **Overview closing cards.** The three steps now have equal height.

### Security
- **No personal details in the videos.** Recordings run terminals through a neutral demo shell (no personal prompt, startup output or saved history), and each recording fails if the account's user name or host prompt is ever on screen.

## [0.13.2] — 2026-11-21

### Fixed
- **Duplicate GitHub releases.** The Linux, Windows and macOS builds could each create their own release for the same version, splitting the installers between two releases and failing the release notes step. The release is now created once before the builds start, and all installers are uploaded to it.

## [0.13.1] — 2026-11-21

### Added
- **Walkthrough video.** `npm run demo` makes a narrated, animated 1080p tour of the whole app (about 4½ minutes): connecting, role defaults, a full plan → approve → run → review, who picks each model, Models and routing, Magpie account routing, juniors and mentors, permissions and reports. It drives the real app with scripted providers, so no credit is used. Built with Playwright, edge-tts voices, Remotion and ffmpeg; see `docs/demo-video.md`.

## [0.13.0] — 2026-11-21

### Added
- **Who decides each model, made explicit.** Order: you, a locked agent, a Locked level, Sovereign (with a reason), a Preferred pin, the level's Magpie group, then Auto peers. Each task in the plan card shows a badge for who decided, and Sovereign's reason.
- **Preferred / Locked levels and Force my setup.** Pins can be a starting point Sovereign may override, or locked; Force locks everything.
- **Always this model** per agent (Agents → agent → How this model is used).
- **Magpie account routing** (off by default): managed `agenthq-simple|standard|complex` groups created through the Magpie CLI, weighted by score, with usage, pace, rotate and weight balancing.
- **Quota-aware routing** that avoids a subscription with less than 10% left while another has room, plus quota cards in Settings.
- **Recent model decisions** table, and learning credited to the model that really served the request.
- **In-app guide** explaining the order of decision and the manual setup.

### Changed
- Ranking and update checks ignore the managed `agenthq` groups.

### Verification
- Unit tests for the decision order, Magpie groups and the CLI command builder; browser tests for badges, Force, locked agent, Magpie sync/remove and the decisions table.

## [0.12.0] — 2026-11-21

### Fixed
- **GPT models were read as "unknown".** Names such as GPT-6.1-Sol, Astra, Terra and Luna were not understood, so every GPT scored the same and Claude always won. Tier names are now understood (Astra and Sol large, Terra mid, Luna small), and a model the name does not explain is sized by its price, borrowed from the same model's Magpie listing.

### Added
- **Fair ranking across vendors.** One scale for every provider, with points lost for older versions and no vendor favoured.
- **Equally good models take turns.** Peers within 2 points (for example Claude Opus 5.5 and GPT-6.1-Sol) share a level's tasks.
- **Learning from real results.** QA approvals and rejections, mentor revisions and task errors adjust a model's score once it has 3 results.
- **Ranking table** in Settings → Models and routing, with level filters, an "In use" badge, backups for Magpie duplicates, why each model scored as it did, and **Reset learned results**.
- **In-app explanation** that model choice is dynamic per task, with a short guide to choosing models by hand, plus a hint in the plan card.

### Changed
- Magpie copies of a model you also have directly are backups, and the "configured default" alias is left out of the ranking.

### Verification
- Unit tests for GPT name reading, price-based sizing, alias and duplicate handling, peer alternation, pins and learning; browser tests for the explanation panel and ranking table.

## [0.11.0] — 2026-11-21

### Changed
- **Routing uses every connected provider by default.** Settings → Models and routing now defaults to **All connected providers**: each level (simple, standard, complex) gets the strongest model of that level across Claude Code, Codex, Gemini, Ollama, Magpie and API keys. One provider still works on its own. *Only Sovereign's provider* remains an option; the 0.10.0 default is switched once, and a choice you made yourself is kept.
- Models are ranked by family and strength across providers (Opus and Fable, GPT-5 and Gemini Pro for complex work; Sonnet for standard; Haiku, mini and Flash for simple; local models below hosted ones; unknown families as standard). Within a family the newest version wins, and a subscription or local model wins over a per-token API key for the same model.
- Sovereign's model list is sorted strongest first with provider, level and strength, and Sovereign may set another provider's model on a task when it fits better.
- **Failover by level:** when a provider runs out of credit, a task moves to the best model of the same level on another provider.
- The Auto choice in Settings shows which provider it comes from.

### Verification
- Unit tests for cross-provider ranking, local and unknown models, subscription preference and same-level failover; browser tests for a plan mixing providers, the new default, and the one-time switch from the 0.10.0 default.

## [0.10.0] — 2026-11-21

### Added
- **One subscription for the whole team.** Settings → Models and routing → *Models agents may use*: **Sovereign's provider only** (default) keeps every agent on the provider Sovereign runs on, so signing in to Claude Code alone is enough. *Any connected provider* restores the old behaviour.
- **A model per task, by complexity.** Sovereign rates each task simple, standard or complex, and the task runs on the model for that level (Haiku, Sonnet and Opus with Claude), whichever agent does it. The plan card has a complexity picker per task, which re-picks the model; model pickers only offer models in scope. Pin a model for any level in Settings, or leave it on Auto.
- **Model update check for every provider.** Agent HQ re-reads the model lists of all connected providers on startup when due and every 1, 6 (default) or 24 hours, or on **Check now**. No prompt is sent (new `POST /api/models/rescan`). New and removed models are logged, listed in Settings and announced by a desktop notification, and Auto levels move to the newest model of their family.

### Changed
- Model suggestions are version-aware: the newest model of a family wins whatever order a provider lists them in, and release dates in ids are ignored.
- New agents Sovereign creates without a model get the model for their level (juniors simple, architects and QA complex, others standard).

### Verification
- Unit tests for tiers, versions, scope (including the CLI default alias), task routing, plan parsing, the model diff and the check interval; browser tests for a Claude-only plan routed by complexity and for pinning tiers and picking up a newly released model.

## [0.9.0] — 2026-11-21

### Added
- **Tasks running at once is now a setting.** Settings → Team building → *Tasks running at once*: 1, 2, 3 (default), 5, 8 or **No limit**. With no limit every task whose dependencies are done starts immediately. One agent still never works on two tasks at once, and the choice is saved.

### Verification
- Unit tests for the setting and the scheduler with and without a limit; the browser Settings test changes it.

## [0.8.0] — 2026-11-21

### Added
- **N+1 mentors for juniors.** Every junior has a direct manager: a senior, or Sovereign. Onboarding suggests the best match for the specialty (shared words, same role, and the senior with the fewest juniors), and you can change the **Mentor** at any time in the agent's Internship card.
- **Mentors card.** A senior with juniors lists them in their details; click one to open it.
- **Sovereign builds the team by itself.** In a plan, Sovereign decides how many agents the work needs, their names, an exact model for each, and which are juniors with which mentor. Nothing needs to be edited by hand, and new agents stay on the team after the run.
- **No caps.** The 4-agent and 20-task limits on a plan are gone. Seniors are created before their juniors so every mentor exists.
- **Settings → Team building.** Choose **Sovereign, automatically** (default) or **Only my agents**.
- The plan card shows a junior badge and who it reports to (N+1 review).

### Changed
- Removing a senior moves their juniors to the best remaining mentor and logs each move.
- Sovereign's roster shows who each junior reports to and who each senior mentors.

### Verification
- Unit tests for mentor candidates, suggestion and model picking; browser tests for onboarding with a suggested mentor, changing a mentor, Settings, and a Sovereign plan that adds a senior with a junior under it.

## [0.7.0] — 2026-11-20

### Added
- **Growth page** (Insights → Growth, `Alt+6`) to follow how each agent specializes on the project. Every agent has a card with its level (Newcomer, Learning, Practiced, Skilled, Expert) and progress to the next, focus areas drawn from its lessons, lessons, confirmations, prompt uses and finished tasks with the success rate, the mix of lesson kinds, lessons per week over 8 weeks, how much came from reviews or from you, and its latest lesson.
- Team totals, a team learning chart and a feed of the newest lessons. Sort agents by experience, recent learning or name; **Open memory** jumps to the agent's Memory panel.
- The desktop tray's quick status shows how many lessons the team has learned, this week's count and the most experienced agent, and opens Growth.
- Reports → Learning links to Growth. Growth is also in the View menu, the command palette and `agenthq://` links.

### Verification
- Unit tests for lesson weighting, levels, focus areas, weekly buckets, per-agent growth and the tray summary; browser tests for the Growth page, sorting, the shortcut, opening memory and the empty state; Growth added to the layout audit at every window width.

## [0.6.0] — 2026-11-20

### Added
- **Agent memory.** Every project now has a long-term memory at `.agent-hq/memory/lessons.json`: plain JSON of short lessons (convention, pitfall, decision, preference, fact), each for one agent or the whole team.
- **Teach agents.** `/remember [@Agent] text` in chat, plus a Memory panel in each agent's details with a Teach form, search, pin, edit and delete.
- **Agents learn on their own.** Mentor revisions, QA rejections and failed verification are journaled, and after each run Sovereign saves up to 6 reflected lessons. Near-duplicates reinforce an existing lesson. The activity log shows what was learned.
- **Lessons are used.** Tasks, mentor reviews, QA and Sovereign chat receive pinned and relevant lessons within a fixed character budget.
- **Search by meaning.** Keyword (BM25) search is always on. With Ollama running, an embedding model (`nomic-embed-text` preferred) adds meaning search, fused with keywords. Settings → Memory and learning can install the model with progress, rebuild the index, or turn it off.
- **Learning mode** setting: every run (default), only from feedback, or off.

### Safety
- Memory paths are confined to the project, including through symlinks. Agents cannot overwrite `.agent-hq/` through file blocks; the attempt is dropped with a warning. A malformed memory file is reported and never overwritten.

### Verification
- Unit tests for storage, merging, search ranking, the meaning-match filter, prompt budgeting, Ollama embeddings and the learning loop; browser tests for the full teach, learn and reuse loop, the settings install flow and layout at every window width.

## [0.5.4] — 2026-11-20

### Fixed
- Claude model pickers now list exact names and versions from Claude Code's account-specific local catalog, following the discovery approach in Magpie's open-source implementation.
- Removed aliases and automatic entries from model choices, model tables, model counts, new role assignments and orchestration suggestions. Choices pass explicit model IDs to Claude Code.
- Previously saved assignments migrate to exact IDs when their model is known. Unknown old assignments ask for an exact model instead of guessing a version.
- Catalog discovery matches the signed-in account, supports older model caches, respects explicit access denials and requires no model-generation call.

### Added
- Claude models show prices automatically, read from the API rate card Claude Code caches for the signed-in account, as Magpie does. The Models table shows input, output and cache rates and the long-prompt tier where one applies.
- Cost estimates count Claude cache reads and 5-minute and 1-hour cache writes at their own rates. The whole call is priced at the long-prompt tier once the full prompt crosses it.
- Reports and agent details label Claude Code subscription usage as valued at API rates, not a bill. Invalid, zero or missing rates are skipped, so those models stay unpriced.

### Verification
- Added account isolation, cache format, denied-model and malformed-cache tests.
- Added rate-card parsing, malformed-rate, cache-token and tiered cost tests, plus browser checks for the pricing column and the Reports cost note.
- Updated the browser regression to check exact-only choices, assignment migration, explicit execution IDs, persistence and model counts.

## [0.5.3] — 2026-11-20

### Fixed
- Claude CLI assignments now show the actual model IDs reported during verification or execution instead of the generic "Claude Code (CLI default model)" label.
- Automatic selections and aliases show their last used model without changing existing assignments. Exact reported IDs also become selectable in the model pickers.
- Model identity updates propagate immediately to agent and role labels, survive restarts, and stay scoped to the project where they were observed. Unverified aliases never claim a guessed version.

### Verification
- Added coverage for CLI response parsing, verification, exact model arguments, persistence, independent aliases, multiple reported models and workspace isolation.
- Added a browser regression for updated agent labels and model choices after a response.

## [0.5.2] — 2026-11-20

### Fixed
- The integrated terminal no longer takes keyboard focus away from the editor, file search or another field when it finishes starting a moment after the page loads. It still focuses itself when you open it, switch terminal tabs, or create a new terminal.

### Verification
- Added a regression test that delays terminal startup and checks that focus stays where the user was typing.
- CI now runs the desktop tests under a window manager so the window buttons are exercised the way they behave on a real Linux desktop, and the terminal exit test no longer depends on the previous command's status.

## [0.5.1] — 2026-11-20

### Fixed
- The "Live communication" panel header in the agent graph and office views no longer wraps when the side panel is narrow or fonts render wider; its title and subtitle now truncate with an ellipsis like the rest of the app. This was the one layout check failing in CI since 0.4.3, so the CI workflow is green again.

## [0.5.0] — 2026-11-20

### Changed
- Shared motion timings across buttons, icon buttons, text fields, tabs, navigation, dialogs, dropdowns and details panels, informed by a comparison with Magpie's open-source UI.
- Tab and sidebar selections now slide between items and refit immediately when the window or their contents resize.
- Dialogs fade their scrim independently from the surface. Dialogs, dropdowns and details panels remain mounted briefly to finish closing; reopening interrupts the exit.
- Sidebar labels fade during collapse without stretching, and controls give restrained press feedback. Existing colors, typography and content remain unchanged.
- Reduced motion disables positional movement and closes overlays immediately. Dialog focus trapping and background inertness remain active until the overlay is removed.

### Verification
- Added interaction checks for selection alignment at 880, 1280 and 1920 px, repeated sidebar toggles, overlay keyboard behavior, focus restoration, reduced motion and interrupted dropdown closing.
- Documented the source comparison and shared motion conventions in `docs/ui-motion.md`.

## [0.4.3] — 2026-11-20

### Fixed
- **Window buttons on Linux now match the app.** Minimize, maximize/restore and close are drawn inside the title bar, so its bottom line runs the full width instead of breaking under the system buttons. They follow the light and dark theme, ease in on hover, and Close turns red.

### Tested
- A desktop test checks the buttons sit inside the title bar and that minimize, maximize, restore and close work.

## [0.4.2] — 2026-11-20

### Fixed
- **Table columns no longer run into each other.** In narrow windows the first column of the Reports tables (run title, agent name and title, model) could shrink below its text, and the text spilled over the Calls and Input columns. Every flexible table column (Reports, Agents, Providers, Local tools, Models and Role defaults) now keeps a readable minimum width. When a table doesn't fit, it scrolls inside its card instead of overlapping.
- Reports tables keep their first column pinned while you scroll sideways, so each row keeps its name.
- In Usage by agent, the agent's name stays whole and its title is shortened first.

### Tested
- The layout audit now flags content that is wider than its table cell, the check that would have caught this bug. It also runs at 880 px for window managers that ignore the 1024 px minimum, and waits for each screen to finish loading before measuring.

## [0.4.1] — 2026-11-20

### Changed
- **Responsive text everywhere**: single-line labels (tabs, sidebar and settings navigation, buttons, badges, breadcrumbs, table headers and cells, card titles, dropdowns, toolbars, dialogs and the tray panel) stay on one line and end in an ellipsis when the window is too narrow. They show in full again as soon as there is room.
- **Overflow tooltip**: hovering or keyboard-focusing cut-off text shows the full text after a short delay. It only appears when text is actually cut off, never gets clipped by its container, can be selected, and closes on Escape, scroll or click.
- Workspace panes fit the window: the chat narrows first, then the explorer, so the editor keeps at least 320 px. Your saved widths come back when the window grows.
- Tables on Agents, Connections, Models and Tasks hide their lowest-priority columns in narrow windows instead of scrolling the page. The data stays available in each detail panel.
- The task board, tab strips and window title bar no longer force a minimum width or overlap at 1024 px.

### Tested
- New layout audit of 20 screens and dialogs at 1024, 1280 and 1920 px, with normal and artificially widened text. It checks for wrapped labels, text that spills or is cut off without an ellipsis, and page-level horizontal scroll.
- Tooltip tests (only when cut off, keyboard focus, Escape, inside the window) and a live-resize test that confirms truncation follows the window without a reload.

## [0.4.0] — 2026-11-20

### Added
- **Tray quick status**: clicking the system tray icon opens a compact panel with Overview, Agents and Activity tabs.
- Live project and run status, task progress, pending changes to review, provider counts, measured tokens and estimated cost.
- Agent status and models, recent activity and errors, and direct shortcuts to agent configuration, Workspace, Tasks, Connections and Settings.
- A downloaded update appears in the panel and opens its release notes in the main window before installation.
- **View → Quick status**, also available with Ctrl+Shift+Space (Cmd+Shift+Space on macOS).

### Changed
- Closing the main window keeps Agent HQ available in the tray while idle as well as during a run. Quit exits the app.
- The popup follows the app's theme, fits within the current display, and dismisses on Escape or when focus leaves it.

### Tested
- Popup placement at screen edges, on another monitor and on small displays.
- Live updates, light and dark themes, long and Arabic text, unpriced usage, keyboard dismissal, navigation, and the popup's isolated preload API.

## [0.3.2] — 2026-11-20

### Changed
- The Agents list now uses the same inset, rounded table surface as Connections, with Settings' shared icon tile and consistent spacing and typography.
- Agent avatars, status badges and grouped model/provider and usage information make the team easier to scan.
- Added team readiness counts, search by name, role, provider or model, and an explicit Configure action for every agent.

### Tested
- Search, empty-state recovery, keyboard navigation and agent configuration in light and dark themes.
- Agents list layout at 1000px and 1440px widths and interaction in the desktop app.

## [0.3.1] — 2026-11-20

### Changed
- Agent details now share Settings' icon tiles, card surfaces, borders and typography, with a clearer avatar header and model and status badges.
- Measured usage appears in compact stat tiles, with separate sections for model selection, role instructions, prompts, history and activity.
- Editing shows an explicit Save changes and Discard bar.
- Detail panels open with a short slide transition that respects reduced motion.

### Tested
- Agent editing, discarding, saving and persistence in light and dark themes, at 1000px and 1440px widths.
- Agent detail interaction in the desktop shell.

## [0.3.0] — 2026-11-20

### Added
- **Update button** in the title bar: once a newer version is downloaded, an **↑ Update** pill appears. Its × hides it for 3 days.
- **What's new before updating**: the pill opens the release notes of every version between yours and the new one, with **Restart to update** and **Later**.
- **Updates that wait for your agents**: if agents are working, **When agents finish** restarts by itself once they are done, and the pill says **Waiting to update**.
- **What's new after an update**: the first launch of a new version shows its notes once.
- **Settings › Updates**: the version and its status, **Check now**, What's new, and options for the update button, automatic updates, how often to check (1, 6, 12 or 24 hours), automatic download (off for metered networks) and automatic restart.
- Tray menu item **Restart to update** and a system notification when an update is ready.
- GitHub release pages now show the notes from this changelog.

### Fixed
- Windows installers were missing from 0.2.0 because two terminal tests used a Linux-only folder.

## [0.2.0] — 2026-11-20

### Added
- **Desktop app** (Electron) with tray icon, notifications, `agent-hq://` deep links, auto-update, and installers: AppImage, `.deb` (Debian/Ubuntu), `.rpm` (Fedora/RHEL), Windows and macOS (Intel and Apple Silicon).
- **Custom title bar** showing the project, run status, the app menu and window controls that match the theme.
- **Integrated terminal**: a real shell (PTY) with tabs, opened in the current project folder with your own shell.
- **Magpie gateway** as a model provider, alongside Anthropic, OpenAI, Gemini, OpenRouter and Ollama.
- **Auto mode**: Ask, Auto-apply or Full access, with a confirmation step, a log of applied changes, and undo.
- **Parallel wave scheduler**: independent tasks run at the same time, and each task gets the files it needs as context.
- **Live Office view** that shows what every agent is doing.
- **Tool install helpers**: missing CLIs (gemini, ollama…) can be installed or copied in one click from Connections.
- **Open in terminal** from the workspace.
- **Type-to-filter** in the project folder picker.
- Version number and a "What's new" link in Settings.
- Unit, end-to-end and desktop test suites, with a scripted provider and a live-Ollama test.

### Changed
- **UI redesign** in a Magpie-inspired style, with a smoother sidebar and modern editor tabs.
- The theme now follows the **system theme** by default.
- **Role defaults** now use the same table layout, borders, status dots and type sizes as Providers and Local tools, with a simple progress bar for team readiness.
- **Settings** redesigned with section navigation and icon cards.
- New logo, social preview, screenshots and README.

### Fixed
- Workspace crashed when the Changes tab was open with no mission.
- Dialogs were cut off inside the sidebar instead of covering the whole window.
- Views failed to load after an update; they now recover from outdated cached files.
- Security hardening of the command runner and file access.

## [0.1.0] — 2026-11-17

First release: web UI, real provider connections, and an orchestrator that adapts when a provider runs out of credit.

[0.4.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.4.0
[0.3.2]: https://github.com/orcalinux/agent-hq/releases/tag/v0.3.2
[0.3.1]: https://github.com/orcalinux/agent-hq/releases/tag/v0.3.1
[0.3.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.3.0
[0.2.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.2.0
[0.1.0]: https://github.com/orcalinux/agent-hq/commit/ad75829

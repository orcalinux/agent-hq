# Changelog

Every release of Agent HQ is listed here, newest first. Versions follow [Semantic Versioning](https://semver.org): a fix bumps the patch number (0.2.**1**), new features bump the minor number (0.**3**.0).

The version shown in the app (Settings → What's new), the desktop installers and the README badge all come from `package.json`, so a release only needs:

```bash
npm version patch   # or: npm version minor
git push --follow-tags
```

…plus a new section in this file describing what changed.

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

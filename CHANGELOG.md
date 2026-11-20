# Changelog

Every release of Agent HQ is listed here, newest first. Versions follow [Semantic Versioning](https://semver.org): a fix bumps the patch number (0.2.**1**), new features bump the minor number (0.**3**.0).

The version shown in the app (Settings → What's new), the desktop installers and the README badge all come from `package.json`, so a release only needs:

```bash
npm version patch   # or: npm version minor
git push --follow-tags
```

…plus a new section in this file describing what changed.

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

[0.3.1]: https://github.com/orcalinux/agent-hq/releases/tag/v0.3.1
[0.3.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.3.0
[0.2.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.2.0
[0.1.0]: https://github.com/orcalinux/agent-hq/commit/ad75829

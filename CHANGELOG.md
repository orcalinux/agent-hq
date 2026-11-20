# Changelog

Every release of Agent HQ is listed here, newest first. Versions follow [Semantic Versioning](https://semver.org): a fix bumps the patch number (0.2.**1**), new features bump the minor number (0.**3**.0).

The version shown in the app (Settings → What's new), the desktop installers and the README badge all come from `package.json`, so a release only needs:

```bash
npm version patch   # or: npm version minor
git push --follow-tags
```

…plus a new section in this file describing what changed.

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

[0.2.0]: https://github.com/orcalinux/agent-hq/releases/tag/v0.2.0
[0.1.0]: https://github.com/orcalinux/agent-hq/commit/ad75829

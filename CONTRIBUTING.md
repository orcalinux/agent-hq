# Contributing to Agent HQ

Agent HQ is a local command center for teams of AI coding agents, released under the [MIT License](LICENSE).

## Set up

Use Node.js 22 and npm. Clone the repository, then run:

```bash
npm ci
npm run dev
```

Open the local address printed by Vite. For the desktop application:

```bash
npm run desktop:dev
```

An authenticated model provider is needed for real model calls. Unit tests and scripted browser tests do not require paid model access. Never include credentials, personal project files or CLI session data in a contribution.

## Propose a change

For a bug, describe what you expected, what happened, the app version and operating system, and the shortest steps to reproduce it. Redact screenshots and logs before attaching them.

For a feature, explain the user problem and the workflow it should improve. Large changes should start with an issue so the scope can be discussed.

Keep changes focused. Reuse the shared UI components, preserve keyboard navigation and the system theme, and check narrow windows as well as wide ones.

## Validate

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
AGENT_HQ_E2E_BUILT=1 npm run test:e2e
npm run test:desktop
git diff --check
```

Desktop tests need a graphical desktop or a virtual display with a window manager. The Linux CI workflow in `.github/workflows/ci.yml` shows the virtual-display setup. `npm run test:tiling` checks native tiling on isolated 1920×1080 and 1280×800 displays with custom OS shortcuts. It needs Xvfb, D-Bus, Xfwm, `xfconf-query`, `xprop`, `xdotool` and `rg`. It does not change your desktop's shortcut configuration.

Add tests for changed behavior. Explain the validation you actually ran in the pull request, and identify anything you could not check.

## Versions and releases

Keep `package.json` and the root entry of `package-lock.json` in sync. Record user-visible changes in `CHANGELOG.md`: patch versions for fixes, minor versions for new features. Do not create a release tag as part of an ordinary contribution; release tags trigger installer publication.

Generated videos, voice recordings, installers, build outputs and dependency directories stay outside Git.

Repository maintainers can find the saved GitHub configuration, verification commands and publication checklist in [docs/github-administration.md](docs/github-administration.md).

## Licensing and attribution

Submit only work you have the right to contribute under MIT. Keep existing third-party notices and check dependency licenses before adding a package. Studying another product does not make its code, images, name or branding part of Agent HQ's MIT license. Clearly identify any reused material and its original license in the pull request.

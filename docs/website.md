# Product website

The public site is `https://orcalinux.github.io/agent-hq/`. Its source is plain HTML, CSS and JavaScript in `site/`, separate from the desktop React application.

## Build and preview

```bash
npm run preview:site
```

This builds `site-dist/` and starts a local server at `http://127.0.0.1:4180`. Set `SITE_PORT` to use another port. `npm run build:site` builds without a server.

`scripts/build-site.mjs` stamps the version from `package.json` and copies the existing logo, social preview and four application screenshots. Stylesheet and script URLs include content hashes so repeat visitors receive matching assets after a deployment. Built files and test results are ignored by Git.

## Design and content

The site retains Agent HQ's blue logo and uses dark surfaces, large headings, monospace annotations and ruled sections. The hero's delegation diagram is explicitly a workflow illustration. The product tour uses actual app screens with example project data; it is not a running app.

The sections introduce the product, show Workspace / Tasks / Office / Growth, explain the run workflow and permission levels, answer setup questions, and offer downloads. Keep statements aligned with shipped functionality. In particular:

- Cloud providers receive relevant task and code context; running the app locally does not make cloud inference private.
- Memory adds project lessons to prompts; it does not retrain models.
- One supported model connection is enough. Provider pricing and quotas still apply.
- Autonomous agent shell access, worktrees and code signing are not currently shipped features.
- Show real release data only. Do not invent adoption numbers, testimonials or performance comparisons.

## Interactions and motion

Product tabs support Left / Right / Home / End keys. The native screenshot dialog supports Escape and restores focus; its original-image link allows full-resolution viewing. Mobile navigation closes on selection, outside click or Escape. FAQ items use native `details` elements.

CSS handles entrance fades and the illustrative task progress. The hero illustration can be paused and stops while offscreen or while the document is hidden. Reduced-motion preferences disable movement, including when changed during the visit. Scroll remains under the visitor's control.

Without JavaScript, navigation, the default screenshot, FAQ, documentation and release-page links remain available. A fallback below the tour links directly to the other images.

## Download links

The script requests GitHub's public latest-release API once, with an eight-second timeout. It selects assets by package type and architecture, accepts download URLs only from this repository's GitHub release-download path, and never starts downloads automatically.

If GitHub is unavailable or an asset is missing, its link continues to open Releases. The page distinguishes available installers from the source version stamped during the website build. The OS highlight is a suggestion; visitors choose the actual package and architecture.

There are no analytics or cookies. Images, scripts and styles are served by GitHub Pages; the latest-release request is the only additional service used by the page.

## Verification and publishing

```bash
npm run test:site
```

Uses the existing Playwright installation. Tests cover 320, 375, 650, 768, 900, 1024, 1440 and 1920 pixel viewports, all tour panels, keyboard and dialog behavior, mobile navigation, release success/failure, untrusted asset URLs, reduced motion and no-JavaScript fallbacks. Release responses are controlled test fixtures; no model calls or downloads occur.

Before publishing a visual change, inspect rendered screenshots at phone, tablet and desktop widths. Automated overflow checks complement visual review.

CI runs the website suite. `.github/workflows/pages.yml` publishes `site-dist/` after relevant changes on `main`; it also supports manual dispatch. It watches website files, the site build script, screenshots, social preview and the package version. Desktop installers are still built separately by the release workflow after a version tag.

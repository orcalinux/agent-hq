# GitHub administration

This is the saved configuration and maintenance checklist for `orcalinux/agent-hq`.
It records repository settings that are managed in GitHub rather than in application code.

Last reviewed: **2026-11-23**. Settings marked **verified** were read through the
authenticated GitHub API on that date. Settings marked **reported** were confirmed
by the maintainer's setup screenshots; they were not independently checked through
the API. This document is a snapshot, not a live settings sync.

## Repository identity

| Setting | Saved value | Evidence |
| --- | --- | --- |
| Repository | `orcalinux/agent-hq` | Verified |
| Description | A local command center for teams of AI coding agents: plan, delegate and supervise Claude Code, Codex, Gemini, Ollama and Magpie agents — web and desktop (Linux, Windows, macOS). | Verified |
| Website | `https://orcalinux.github.io/agent-hq/` | Verified |
| Topics | `ai-agents`, `claude-code`, `codex`, `desktop-app`, `electron`, `llm`, `ollama`, `orchestrator`, `react`, `typescript` | Verified |
| License | MIT; see [`LICENSE`](../LICENSE) | Repository file |
| Social preview | Use [`social-preview.png`](social-preview.png) in Settings → General → Social preview | Asset available; upload not verified |

Edit the description, website and topics using the gear beside **About** on the
repository home page. Use the project website as the website field.

## Protect the default branch

Location: **Settings → Rules → Rulesets**.

| Setting | Saved value |
| --- | --- |
| Name | `Protect main` |
| Enforcement | Active |
| Target | Default branch (`main`); no exclusions |
| Restrict deletions | Enabled |
| Block force pushes | Enabled |
| Bypass list | Empty |
| Restrict updates | Not enabled |
| Require a pull request before merging | Not enabled |
| Require approvals | Not enabled |
| Require status checks | Not enabled |

**Verified:** the active ruleset contains only the deletion and non-fast-forward
rules. It protects the default branch while allowing ordinary direct pushes.

If recreating it: create a branch ruleset, name it `Protect main`, set enforcement
to **Active**, select **Include default branch**, enable **Restrict deletions**
and **Block force pushes**, then save.

Revisit required pull requests and CI checks when the contribution workflow is
ready for them. Check the exact current CI job names before adding required checks.

## Security settings

Location: **Settings → Advanced Security**. GitHub may group individual options
under **Code Security**, **Secret Protection** or **Dependabot**. The repository's
**Security and quality** tab shows alerts and scan results.

| Setting | Saved value | Evidence |
| --- | --- | --- |
| Private vulnerability reporting | Enabled | Verified |
| Dependency graph | On | Reported |
| Automatic dependency submission | Disabled | Reported |
| Dependabot alerts | On | Verified |
| Malware alerts | On | Reported |
| Dependabot security updates | On | Verified |
| Grouped security updates | On | Reported |
| Dependabot auto-triage rules | One enabled rule | Reported; rule details not recorded |
| Dependabot version updates | No repository configuration file | No `.github/dependabot.yml` checked in |
| CodeQL analysis | Default setup configured; default query suite; weekly schedule | Verified |
| CodeQL languages | JavaScript / TypeScript | Verified |
| AI Scan for repositories | Off | Reported |
| AI Scan for pull requests | Off | Reported |
| Scan for AI applications | Off | Reported |
| Copilot Autofix | On | Reported |
| Agentic autofix | Off | Reported |
| Security alert failure threshold | High or higher | Reported |
| Standard alert failure threshold | Only errors | Reported |
| Secret scanning | Enabled | Verified |
| Push protection | Enabled | Verified |
| Non-provider secret patterns | Disabled | Verified |
| Secret validity checks | Disabled | Verified |

**Push protection** checks pushes for supported secret patterns. If it blocks a
real credential, revoke or rotate that credential and remove it from the commits
before retrying. Follow [`SECURITY.md`](../SECURITY.md) to report vulnerabilities.
Do not include secrets in issues, screenshots or documentation.

Dependabot security updates can open pull requests even without a
`dependabot.yml`. Version updates are a separate setting; broad scheduled dependency
upgrades were left unconfigured during this setup.

## GitHub Actions

Location: **Settings → Actions → General → Workflow permissions**.

| Setting | Saved value | Evidence |
| --- | --- | --- |
| Default workflow permissions | Read and write | Verified |
| Allow GitHub Actions to create and approve pull requests | Off | Verified |

Workflow files may declare their own permissions. The checked-in workflows are:

| Workflow | File | Trigger and purpose |
| --- | --- | --- |
| CI | [ci.yml](../.github/workflows/ci.yml) | Pushes to `main` and pull requests; type checks, unit tests, builds, browser regressions and desktop tests |
| Website | [pages.yml](../.github/workflows/pages.yml) | Relevant site, version or workflow changes on `main`, or manual dispatch; builds and deploys Pages |
| Release | [release.yml](../.github/workflows/release.yml) | `v*` tags, or manual dispatch; builds desktop installers |
| CodeQL | Managed by GitHub default setup | Security analysis; configuration is stored in GitHub |

The Website workflow explicitly requests `contents: read`, `pages: write` and
`id-token: write`. Release requests `contents: write`.

For failed checks, open **Actions → failed run → failed job** and read the failing
step. A green unrelated workflow does not establish that CI passed. Check the
workflow for the exact commit or pull request under review.

## Website / GitHub Pages

Location: **Settings → Pages**.

| Setting | Saved value | Evidence |
| --- | --- | --- |
| Build and deployment source | GitHub Actions | Verified |
| Public address | `https://orcalinux.github.io/agent-hq/` | Verified |
| Enforce HTTPS | Enabled | Verified |

The source lives in [`site/`](../site/). Build it locally with:

```bash
npm run build:site
```

The generated `site-dist/` is a deployment artifact. The Website workflow uploads
and deploys it; do not add generated output or a separate Jekyll workflow.

To redeploy without changing files, use **Actions → Website → Run workflow** on
`main`. Verify that deployment succeeds and that the public page loads. Check that
its download link points to an available release with the expected installers.

## Routine maintenance

See [security-review.md](security-review.md) for the 0.15.1 alert review and fixes.

1. Open **Security and quality** and review Dependabot, CodeQL and secret alerts.
2. Review dependency pull requests individually, including major-version migration
   notes and lockfile changes. Check whether related updates make other PRs redundant.
3. Wait for the relevant PR's CI checks and inspect failures before merging.
4. Check **Actions → Website** after website changes.
5. Recheck this document after changing repository settings; update the review date
   and distinguish verified values from unverified ones.

## Release checklist

See [`CONTRIBUTING.md`](../CONTRIBUTING.md#versions-and-releases) for version policy.

1. Update `package.json`, both root version entries in `package-lock.json`, and
   `CHANGELOG.md`. Describe the changes for that exact version.
2. Run the validation commands in `CONTRIBUTING.md` and inspect CI for the intended
   release commit.
3. Commit and push the reviewed source changes. Keep videos, recordings, installers,
   credentials and generated build output outside Git.
4. When publication is intended, tag the release commit `v<package.json version>`
   and push that tag. A version bump alone does not publish installers.
5. Check every Release workflow job, including all three desktop platforms, notes
   and checksums. Confirm the release contains installers, update metadata and
   `SHA256SUMS.txt`.
6. Verify the website download and the application's update flow against the
   published release.

A pushed `v*` tag publishes a GitHub release and installers. A manual Release
workflow dispatch builds artifacts without publishing a tagged release. Code
signing still requires signing credentials; enabling GitHub security settings
does not sign installers.

## Read-only verification commands

These commands require an authenticated GitHub CLI account with access to the
repository settings. They inspect settings; they do not change them.

```bash
gh api repos/orcalinux/agent-hq --jq '{description,homepage,topics,security_and_analysis}'
gh api repos/orcalinux/agent-hq/rulesets
gh api repos/orcalinux/agent-hq/rulesets/RULESET_ID
gh api repos/orcalinux/agent-hq/private-vulnerability-reporting
gh api repos/orcalinux/agent-hq/vulnerability-alerts --include
gh api repos/orcalinux/agent-hq/code-scanning/default-setup
gh api repos/orcalinux/agent-hq/actions/permissions/workflow
gh api repos/orcalinux/agent-hq/pages
gh run list --repo orcalinux/agent-hq --limit 10
```

Replace `RULESET_ID` with the ID returned by the ruleset list. An HTTP `204` response
from the vulnerability-alerts endpoint means alerts are enabled. Check settings
marked **reported** in the GitHub UI; these commands do not verify every row.

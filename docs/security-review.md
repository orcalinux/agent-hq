# Security alert review — 0.15.1–0.15.2

Review date: **2026-11-23**. Initial GitHub findings: **6 open Dependabot alerts,
13 open CodeQL alerts, 0 open secret-scanning alerts**.

Alert numbers below identify findings in `orcalinux/agent-hq`; they are not a
general severity ranking of application features. GitHub's counts change after
the default branch and its analysis are updated.

Version 0.15.2 preserves `localhost` in outgoing URLs for TLS hostname verification
and IPv6 compatibility. The local OS resolver is trusted, as are its executable
search paths; the request policy does not replace OS security.

## Dependencies

| Dependabot alerts | Package | Change |
| --- | --- | --- |
| #1, #2, #5 | Vitest / `@vitest/mocker` | Upgrade to 4.1.12, including the patch newer than the original 4.1.11 update proposal |
| #3, #4 | Tinypool | Removed from the dependency tree by the Vitest 4 upgrade |
| #6 | Minimatch | Override versions `>=7 <11.0.1` to 11.0.9; older unaffected major versions remain |

`npm audit` reports **0 vulnerabilities** against the updated lockfile. This is
the registry advisory result at review time, not a guarantee that dependencies
have no undiscovered flaws. Desktop packaging uses Minimatch, so a real `.deb`
build was also checked after the override.

## GitHub follow-up

After pushing source commit `7372146`, GitHub closed all six Dependabot alerts.
The three older Dependabot pull requests were closed because the tested update
already includes their fixes and the newer mocker patch.

CodeQL analysis `2228107874` completed successfully on that commit. Eleven
original code alerts were automatically marked fixed. The analysis reported five
findings, including the account-cache hash warning; these were reviewed and
dismissed individually as false positives with explanations attached in GitHub:

| Alert | Evidence for the dismissal |
| --- | --- |
| #1 | The reported data-flow path passes through `executionTimeoutMs`, which rejects nonfinite/nonnumeric input and clamps duration to 1000–600000 ms. CodeQL propagates taint through the clamp without recognizing its bounds. |
| #12 | An account UUID is hashed solely to locate the CLI's existing cache file; no password authentication uses this hash. |
| #14 | The reported URL passes through `checkedRequestUrl`. Exact origin checks, loopback handling, protocol checks and blocked redirects constrain the destination. Tests cover rejected metadata addresses, misleading hosts and redirects between real servers. |
| #15, #16 | The SARIF traces carry the directory into separate `open`, `gnome-terminal`, `konsole` and `xfce4-terminal` argument entries. They do not inject it into executable shell text; `spawn` has `shell: false`. |

At the end of this triage, GitHub reported **0 open Dependabot alerts, 0 open
code-scanning alerts and 0 open secret-scanning alerts**. Dismissed findings
remain visible under GitHub's dismissed-alert filter. No CodeQL queries were
disabled. Re-review these dismissals if request validation, terminal construction
or timeout handling changes.

## Code findings

| CodeQL alerts | Area | Resolution / review |
| --- | --- | --- |
| #6, #13 | Release-note regex injection / incomplete escaping | Remove input interpolation into regular expressions. Parse headings with a fixed pattern and compare version strings literally. Regression tests include regex metacharacters, backslashes and unmatched brackets. |
| #1 | User-controlled command timeout | Require a finite number, bound it to 1–600 seconds and use a fixed default for invalid input. |
| #9, #11 | Provider executable selection | Resolve executables from the supported provider names; ignore stored `cliBinary` overrides during verification and chat. Pass arguments separately with `shell: false`. |
| #10 | Agent command execution | Return the program from the allowlist entry and spawn without a shell. Existing command, option and workspace restrictions remain. |
| #7, #8 | External terminal launch | Spawn with `shell: false`, single-quote the configured shell path inside installation scripts, escape AppleScript strings and reject inherited installer properties. A real POSIX shell test verifies that a filename containing a quote and command substitution is treated literally. |
| #2, #3, #4, #5 | Provider and embedding request destinations | Centralize requests in `server/network.ts`: allow official cloud API origins, loopback services and explicitly trusted remote origins; refuse credentials, fragments and redirects. Apply the same policy to discovery, chat, embeddings, downloads and quota requests. |
| #12 | SHA-256 of a Claude account UUID | Reviewed as a false positive: this hash reproduces Claude Code's catalog-cache filename. It is not a password verifier, API key derivation or authentication decision. Preserve the filename algorithm so existing CLI catalogs remain readable. |

## Network trust configuration

Local Ollama and Magpie work without additional configuration. Remote services
require an exact trusted origin in the launch environment:

```bash
AGENT_HQ_ALLOWED_ENDPOINTS=http://192.168.1.20:11434,https://models.example:8443
```

Set this before launching Agent HQ and restart after changing it. Include ports
when needed; do not include paths or query strings. Enter the service's final
endpoint in Connections, because redirects are not followed.

Existing remote connections need this setting after upgrading. Explicitly
trusting an origin authorizes requests to that service, including their prompts
and relevant credentials. The launch environment, installed binaries and local
OS remain trusted. This policy is not a sandbox for an already compromised host.

## Verification

- TypeScript checks and application/server builds.
- 218 unit tests, including endpoint rejection, exact-origin matching, blocked
  redirects between real local HTTP servers, literal shell paths and release
  version matching.
- 18 desktop tests on Linux under Xvfb/Openbox; the separately enabled native
  tiling test is skipped by this suite.
- A real Linux `.deb` package build with the updated packaging dependencies.
- A real `claude/claude-haiku-5-5` call through the running Magpie gateway returned
  the required `SECURITY_CHECK_OK` response through the hardened chat request path.
- Development browser suite: 42 passed initially; two failures (graph fixture
  initialization and delayed-terminal focus) and their two skipped follow-on
  tests all passed on the targeted rerun. These intermittent failures are
  recorded rather than treated as a clean first-pass run.
- Production browser suite: all 46 applicable tests passed; two opt-in live-model
  scenarios and two screenshot-generation scenarios were skipped. The separate
  real-model smoke check above ran successfully.

GitHub CI should be checked for the final release commit before publication.
A local passing audit does not itself close a GitHub alert. Review
new scan output before dismissing any finding; record a concrete reason for
false positives rather than disabling queries.

## Remaining boundaries

External terminal commands are intentionally available to the person using the
desktop app. Agent commands retain a separate allowlist; project npm scripts
are executable project code, not a security sandbox. Provider CLI binaries come
from the local PATH and known installation locations.

The new terminal quoting regression runs a real POSIX shell. Actual macOS and
Windows terminal applications were not exercised in this Linux review. Release
builds and platform-specific runtime verification remain separate checks.

See [`SECURITY.md`](../SECURITY.md) for reporting, key-storage limitations and
unsigned installers, and [`github-administration.md`](github-administration.md)
for the saved repository security configuration.

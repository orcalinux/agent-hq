# Security alert review — 0.15.1

Review date: **2026-11-23**. Initial GitHub findings: **6 open Dependabot alerts,
13 open CodeQL alerts, 0 open secret-scanning alerts**.

Alert numbers below identify findings in `orcalinux/agent-hq`; they are not a
general severity ranking of application features. GitHub's counts change after
the default branch and its analysis are updated.

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

Browser and GitHub scan results should be checked for the final commit before
publication. A local passing audit does not itself close a GitHub alert. Review
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

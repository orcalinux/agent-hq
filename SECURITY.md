# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab → Report a vulnerability). If that option is not available yet, open an issue that says only "security contact requested", with no details, and a maintainer will arrange a private channel.

Include the version (Settings → What's new), your operating system, and steps to reproduce.

## What to expect

- Acknowledgement of your report, then a fix or a written explanation.
- Credit in the changelog if you want it.

## Scope and known limits

- The local server listens on `127.0.0.1` only and accepts loopback requests only.
- Agents propose file changes; nothing is written outside the project folder, and agents do not get a shell.
- Provider API keys are stored AES-256-GCM encrypted in the local config file, with a random key in a separate `secret.key` file; both have permissions `0600`. This protects the config file if it is copied, backed up or shared on its own. It does not protect against another process running as your user, which can read both files. When the desktop app finds a usable system keychain (Electron `safeStorage` with GNOME Keyring or KWallet), the key file is itself sealed by the keychain, which does close that gap. If none is available (for example a bare window manager with no keyring), the app falls back to the key file and says nothing more; if a sealed key is ever unreadable, saving is refused rather than dropping your keys. The keychain path is covered by unit tests with a stand-in keychain; it has not been run against a real keyring yet.
- Installers are not code-signed yet. Verify a download with `SHA256SUMS.txt` on the release page: `sha256sum -c SHA256SUMS.txt`.

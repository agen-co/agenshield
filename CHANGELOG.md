# Changelog

Customer-facing release notes for **AgenShield**. Each release's notes are also
attached to its [GitHub Release](https://github.com/agen-co/agenshield/releases),
alongside the signed installer and checksums.

Entries are grouped as **New** (features), **Improved** (enhancements), and
**Fixed** (bug fixes).

## Unreleased

## v0.11.5 - 2026-06-24


### New

- **Monitor-first network controls:** Admin-managed policy can now roll out additional macOS network inspection safeguards for DNS, QUIC, IP-literal TLS traffic, and SNI-to-IP consistency in stages.

### Improved

- **Security hardening:** AgenShield now requires stronger local proof before issuing admin access, blocks more internal-network escape paths, tightens broker access, fails closed on more TLS inspection errors, and strengthens agent file, command, workspace, and policy-bundle protections.
- **Dashboard accuracy:** The desktop app now shows the active managed policy bundle, rule mode, sync timing, extension health, and host-relevant agent status more accurately.
- **Upgrade reliability:** Upgrades now download and stage the new release before stopping protection, reducing the chance that a failed download leaves the daemon stopped.
- **Workspace visibility:** AgenShield can detect agent resources in newly discovered workspaces without quarantining or changing files unless policy calls for it.
- **Telemetry reliability:** Large security and filesystem events are trimmed to fit cloud ingest limits instead of being dropped, while preserving the key security details.

### Fixed

- **Uninstall works after partial removal:** `npx agenshield uninstall` no longer opens the macOS installer when only leftover artifacts remain. It now removes AgenShield residue directly, including the trusted CA.
- **Install no longer forces sign-in:** `agenshield start` no longer opens the browser or waits on login during install/startup. Users can sign in from the app or CLI when ready.
- **Sessions recover after daemon restarts:** The menubar and desktop app now refresh authentication and reload data after daemon restarts or token expiry instead of showing stale or empty views.
- **Agent and workspace discovery starts more reliably:** The agent-resource monitor no longer blocks daemon startup, and workspace rediscovery now works after policy or profile changes.
- **Activity feed is less noisy:** The desktop activity feed drops low-value system events earlier and pauses hidden-window updates to reduce unnecessary CPU use.

_macOS (Apple Silicon / arm64) only._



## v0.11.4 - 2026-06-18


### Fixed

- **Uninstall cleans up more completely.** `npx agenshield uninstall` now handles partial installs, removes the desktop dashboard and its saved data, and tells you how to clear stale certificate settings from already-running terminal and GUI apps.

_macOS (Apple Silicon / arm64) only._



## v0.11.3 - 2026-06-18

{"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest/commits/commits#list-pull-requests-associated-with-a-commit","status":"403"}


## v0.11.2 - 2026-06-18

{"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest/commits/commits#list-pull-requests-associated-with-a-commit","status":"403"}


_Notes for the next release will appear here when it ships._

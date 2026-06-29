# Changelog

Customer-facing release notes for **AgenShield**. Each release's notes are also
attached to its [GitHub Release](https://github.com/agen-co/agenshield/releases),
alongside the signed installer and checksums.

Entries are grouped as **New** (features), **Improved** (enhancements), and
**Fixed** (bug fixes).

## Unreleased

## v2026.6.5 - 2026-06-29


### New

- **One-click diagnostics for support.** The desktop app can now save a complete diagnostics `.zip` with AgenShield logs, extension status, Full Disk Access posture, proxy and certificate checks, daemon/cloud status, crash reports, and local user context.
- **Local user visibility.** The Overview dashboard now shows the macOS users AgenShield knows about, including the active console session, so admins can verify the machine context after install.
- **Clear enforcement status in the app.** AgenShield now shows a prominent alert when endpoint or network enforcement is not active, including a direct path to Full Disk Access settings when that is the likely fix.

### Improved

- **Security hardening:** Cloud signing-key rotation now works from a built-in trust anchor, rejected policy bundles no longer mark themselves as applied, and devices periodically re-pull full policy so signing or sync recovery can heal without re-enrollment.
- **Install and upgrade recovery are smoother.** The macOS installer now uses native notifications for required approvals, waits less time before continuing when Full Disk Access is not yet granted, and clears stale prior-version enforcement-disable markers when the newly installed version can safely enforce.
- **Large resource inventories are easier to review.** Skills and MCP resource lists now load in pages, keep true totals visible, prioritize items that need attention, and avoid flicker during discovery updates.
- **Diagnostics are more complete.** Support bundles now include the logged-in user's desktop logs, crash reports, and certificate checks even when AgenShield is running as a root LaunchDaemon.

### Fixed

- **Sign-in opens the right hosted login.** OAuth login now targets the AgenShield application configuration and fails clearly if enrollment metadata is missing, instead of routing users to the wrong portal or returning an opaque invalid-client error.
- **Emergency-disable recovery guidance is reachable.** `agenshield doctor --fix` can recover local enforcement when possible and now reports when an extension immediately re-disables itself because the installed build still needs a fix.
- **User attribution no longer appears as root.** Telemetry, MCP servers, and resource catalog entries now attribute activity to the owning macOS user where AgenShield can determine it.
- **Uninstall completes with less delay.** Profile teardown avoids unnecessary privileged wait steps during process cleanup.

_macOS (Apple Silicon / arm64) only._



## v2026.6.3 - 2026-06-29


### New

- **One-click diagnostics for support.** The desktop app can now save a complete diagnostics `.zip` with AgenShield logs, extension status, Full Disk Access posture, proxy and certificate checks, daemon/cloud status, crash reports, and local user context.
- **Local user visibility.** The Overview dashboard now shows the macOS users AgenShield knows about, including the active console session, so admins can verify the machine context after install.
- **Clear enforcement status in the app.** AgenShield now shows a prominent alert when endpoint or network enforcement is not active, including a direct path to Full Disk Access settings when that is the likely fix.

### Improved

- **Security hardening:** Cloud signing-key rotation now works from a built-in trust anchor, rejected policy bundles no longer mark themselves as applied, and devices periodically re-pull full policy so signing or sync recovery can heal without re-enrollment.
- **Install and upgrade recovery are smoother.** The macOS installer now uses native notifications for required approvals, waits less time before continuing when Full Disk Access is not yet granted, and clears stale prior-version enforcement-disable markers when the newly installed version can safely enforce.
- **Large resource inventories are easier to review.** Skills and MCP resource lists now load in pages, keep true totals visible, prioritize items that need attention, and avoid flicker during discovery updates.
- **Diagnostics are more complete.** Support bundles now include the logged-in user's desktop logs, crash reports, and certificate checks even when AgenShield is running as a root LaunchDaemon.

### Fixed

- **Sign-in opens the right hosted login.** OAuth login now targets the AgenShield application configuration and fails clearly if enrollment metadata is missing, instead of routing users to the wrong portal or returning an opaque invalid-client error.
- **Emergency-disable recovery guidance is reachable.** `agenshield doctor --fix` can recover local enforcement when possible and now reports when an extension immediately re-disables itself because the installed build still needs a fix.
- **User attribution no longer appears as root.** Telemetry, MCP servers, and resource catalog entries now attribute activity to the owning macOS user where AgenShield can determine it.
- **Uninstall completes with less delay.** Profile teardown avoids unnecessary privileged wait steps during process cleanup.

_macOS (Apple Silicon / arm64) only._



## v2026.6.4 - 2026-06-28


### New

- **One-click diagnostics for support.** The desktop app can now save a complete diagnostics `.zip` with AgenShield logs, extension status, Full Disk Access posture, proxy and certificate checks, daemon/cloud status, crash reports, and local user context.
- **Local user visibility.** The Overview dashboard now shows the macOS users AgenShield knows about, including the active console session, so admins can verify the machine context after install.
- **Clear enforcement status in the app.** AgenShield now shows a prominent alert when endpoint or network enforcement is not active, including a direct path to Full Disk Access settings when that is the likely fix.

### Improved

- **Security hardening:** Cloud signing-key rotation now works from a built-in trust anchor, rejected policy bundles no longer mark themselves as applied, and devices periodically re-pull full policy so signing or sync recovery can heal without re-enrollment.
- **Install and upgrade recovery are smoother.** The macOS installer now uses native notifications for required approvals, waits less time before continuing when Full Disk Access is not yet granted, and clears stale prior-version enforcement-disable markers when the newly installed version can safely enforce.
- **Large resource inventories are easier to review.** Skills and MCP resource lists now load in pages, keep true totals visible, prioritize items that need attention, and avoid flicker during discovery updates.
- **Diagnostics are more complete.** Support bundles now include the logged-in user's desktop logs, crash reports, and certificate checks even when AgenShield is running as a root LaunchDaemon.

### Fixed

- **Sign-in opens the right hosted login.** OAuth login now targets the AgenShield application configuration and fails clearly if enrollment metadata is missing, instead of routing users to the wrong portal or returning an opaque invalid-client error.
- **Emergency-disable recovery guidance is reachable.** `agenshield doctor --fix` can recover local enforcement when possible and now reports when an extension immediately re-disables itself because the installed build still needs a fix.
- **User attribution no longer appears as root.** Telemetry, MCP servers, and resource catalog entries now attribute activity to the owning macOS user where AgenShield can determine it.
- **Uninstall completes with less delay.** Profile teardown avoids unnecessary privileged wait steps during process cleanup.

_macOS (Apple Silicon / arm64) only._



## v2026.6.2 - 2026-06-28


### New

- **Desktop dashboard is now the main AgenShield interface.** The app adds live system metrics, richer policy views, grouped agent resources, detected MCP servers, and Finder reveal actions for reviewed resources.
- **Remote host recovery support.** AgenShield endpoints can now accept signed emergency-disable commands from AgenShield Cloud, giving admins a remote recovery path if enforcement wedges a host.
- **Calendar-based versioning.** Releases now use `YYYY.M.N`, making it easier to tell when a build shipped and preserving correct upgrade ordering across branches.

### Improved

- **Menubar status reflects actual protection health.** The shield dot is green when endpoint and network enforcement are healthy; pending skill approvals and stopped optional tools are shown in the popover without making the device look degraded.
- **Upgrades are more reliable.** `agenshield upgrade` now stops the privileged daemon cleanly and restarts an already-open dashboard on the updated build, avoiding failed first upgrade attempts and stale frozen windows.
- **Setup and updates now use the desktop app.** The deprecated browser dashboard has been removed; setup opens the menubar dashboard, and upgrades run in the terminal.
- **Diagnostics report the true enforcement posture.** `agenshield doctor` now distinguishes registered extensions from actually enforcing protection, including emergency disable, missing Full Disk Access, network filter outages, and fallback mode.
- **Agent-host performance is lighter.** AgenShield reduces unnecessary discovery, enforcement sweeps, telemetry retries, and stale process tracking, lowering background work during busy agent sessions.
- **Security hardening:** Policy bundles and cloud commands now support trusted signing-key rotation, broader signed policy coverage, authenticated keyring updates, OAuth callback protection, stricter network-policy validation, local policy-bundle signature checks, safer privileged operations, capped proxy responses, bounded caches, and safer handling of process ID reuse.

### Fixed

- **Login-screen freeze protection.** AgenShield now caches repeated code-signing checks and rate-limits fresh attestations during enforcement sweeps, preventing the trust-service storm that could starve macOS login components.
- **Host lockout self-healing.** Near-deadline host enforcement pressure can now temporarily force-allow Apple/system login components while keeping sandboxed agent enforcement active, reducing the chance of a machine needing safe-mode recovery.
- **Network enforcement no longer blocks on an absent or invalid initial policy bundle.** If no valid bundle has ever loaded, AgenShield observes and raises a clear alarm instead of denying traffic; if a previous valid bundle exists, it stays in effect.
- **Monitor-mode network policies behave consistently.** Non-canonical per-rule enforcement values now inherit the bundle mode instead of accidentally hard-blocking traffic intended only for observation.
- **TLS inspection trust works for agents.** The public CA certificate is written with readable permissions and existing overly restrictive copies are healed automatically, so protected agents can trust AgenShield-managed TLS termination.
- **Dashboard live data stays accurate.** Reconnects no longer overlap event streams or reuse rejected tokens, stale metrics no longer appear as live, and policies refresh immediately after cloud sync.
- **Agent resource status is clearer.** Quarantined-skill refresh failures are visible in the menubar, markdown skills are grouped as skills instead of rules, and pending resources remain visible in the right status filters.

_macOS (Apple Silicon / arm64) only._



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

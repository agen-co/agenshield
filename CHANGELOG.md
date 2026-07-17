# Changelog

Customer-facing release notes for **AgenShield**. Each release's notes are also
attached to its [GitHub Release](https://github.com/agen-co/agenshield/releases),
alongside the signed installer and checksums.

Entries are grouped as **New** (features), **Improved** (enhancements), and
**Fixed** (bug fixes).

## Unreleased

## v2026.7.16 - 2026-07-17


### New

- **Richer support diagnostics.** Support snapshots now include detailed memory attribution and extension-readiness counters, giving admins and support clearer evidence when investigating resource use or macOS protection state.

### Improved

- **Lower daemon memory use.** The packaged daemon now uses a smaller release build and loads worker code only when needed, reducing validated cold-start memory by about 45 MB and loaded-session memory by about 59 MB.
- **Better responsiveness under load.** More disk, keychain, policy, audit, storage, settings, MCP, and workspace-permission work now runs asynchronously, reducing stalls during telemetry upload, policy refresh, and active enforcement.
- **More accurate system-extension health.** Transient macOS probe failures are now reported as unknown instead of being mistaken for missing extensions, FDA problems, or provider failures.

### Fixed

- **Host enforcement no longer flaps during temporary macOS probe failures.** Brief probe timeouts no longer cause AgenShield to rewrite extension configuration, churn extension reloads, or temporarily disarm host/root enforcement after a session is confirmed.
- **Cleaner agent activity timelines.** AgenShield no longer records its own housekeeping commands as agent activity when the daemon is restarted from an agent-owned terminal.
- **Fewer false-positive secret findings.** Secrets sent to their cataloged expected origin are no longer flagged as exposed; blocked secrets and wrong-destination secrets still surface as critical findings.

_macOS (Apple Silicon / arm64) only._



## v2026.7.15 - 2026-07-16


### New

- **Guided activation:** `agenshield activate` now walks users through Endpoint Security, Network Extension, and Full Disk Access approval, then verifies that protection is actually enforcing before calling activation complete.

### Improved

- **Faster agent attribution under load:** AgenShield now uses a lower-overhead process attribution path for enforcement and telemetry, reducing churn during busy agent sessions and improving accuracy for short-lived child processes.
- **Security hardening:** Production installs now keep the daemon’s diagnostic inspector closed by default, reducing local exposure of sensitive daemon memory and credentials.

### Fixed

- **Endpoint Security enforcement stays armed after upgrades:** In-place upgrades no longer leave host/root execution enforcement silently unarmed if configuration is briefly unavailable during restart, and status now reports enforcement only after the extension is truly ready.
- **Certificate trust repair on newer macOS versions:** When the network inspection certificate is installed but not trusted, AgenShield can now complete trust through an interactive admin approval flow, retry after login, and surface a menubar “Trust Certificate” action.

_macOS (Apple Silicon / arm64) only._



## v2026.7.14 - 2026-07-15


### New

- **Emergency disable now covers network inspection.** When an admin engages emergency disable, AgenShield now stops intercepting new inspected connections and releases already claimed connections so apps can reconnect directly while recovery is active.

### Improved

- **Recovery resumes enforcement with fresh process state.** Clearing emergency disable now rebuilds process attribution before enforcement resumes, reducing stale policy decisions after a recovery window.
- **Better resilience during event spikes.** AgenShield now avoids blocking enforcement on slow macOS identity checks, coalesces high-churn process updates, and reduces background scan pressure during busy agent sessions.
- **Faster self-healing for stalled enforcement.** If enforcement work stalls, AgenShield now recycles the affected enforcement client automatically before macOS deadlines are missed.
- **More reliable remote recovery.** Emergency-disable engage and clear commands now retry until AgenShield confirms they actually took effect, reducing false “recovered” states in admin workflows.

### Fixed

- **Crash alerts are no longer repeated after restarts.** AgenShield now remembers already reported enforcement crashes, ignores reports from previous boots or older builds, and only marks crash reports handled after telemetry accepts them.
- **Security hardening:** AgenShield now honors emergency-disable only when the legitimate root-owned recovery marker is present and rejects stale or invalid markers consistently.
- **Policy reloads are less likely to block enforcement.** Cache clearing and reload work now run through bounded background paths instead of competing with live enforcement decisions.
- **Workspace security scans no longer overlap.** Full scans are serialized and fallback polling is rate-limited, reducing duplicate quarantine errors and CPU or disk spikes in large workspaces.

_macOS (Apple Silicon / arm64) only._



## v2026.7.13 - 2026-07-15


### New

- **Release notes review before upgrades.** In-app updates now show the target version’s release notes and require approval before AgenShield starts the upgrade.
- **Security hardening:** Cloud-managed network inspection controls for SNI binding, QUIC/UDP handling, DNS fast-allow behavior, IP-literal diversion, and no-ClientHello traffic now reach the signed macOS network configuration. DNS resolver allowlists are derived locally from macOS, so cloud policy cannot spoof a device’s resolver list.

### Improved

- **Daemon resilience under heavy activity.** High-volume endpoint and network event bursts are now processed in bounded batches with backpressure, reducing the chance that the daemon, desktop app, or status checks become unresponsive during large agent workloads.
- **Support diagnostics are more actionable.** Support bundles now include process resource usage, short-timeout daemon status, runtime queue counters, and memory attribution by worker so admins can diagnose slowdowns or high memory use faster.
- **Policies are easier to scan.** The Policies view now shows readable rule summaries, action labels, disabled state, and inline patterns while keeping raw JSON available for deeper inspection.
- **Full Disk Access guidance is more precise.** AgenShield now opens the macOS Full Disk Access settings only when it has positive evidence that permission is actually missing.

### Fixed

- **Network targets are attributed more accurately.** QUIC/UDP and fallback TCP observations are now correlated so network telemetry avoids duplicate bare-IP targets when the hostname is known, while ambiguous DNS matches remain safely reported as IPs.
- **Update checks stay on the correct release path.** Stable installs are no longer offered pre-releases, and alpha, beta, or release-candidate installs can move forward to a newer stable release when one is available.
- **Endpoint health messages no longer mislabel generic failures as Full Disk Access issues.** When the Endpoint Security extension is not running or cannot be verified, AgenShield now reports that condition directly instead of sending admins to fix a permission that may already be granted.
- **Packaged daemon builds include all required worker assets.** The standalone daemon now validates that every embedded worker is present before release, preventing packaged builds from failing at startup because of missing worker files.

_macOS (Apple Silicon / arm64) only._



## v2026.7.11 - 2026-07-14

<!-- CURSOR_SUMMARY -->
> [!NOTE]
> **Medium Risk**
> Weakens a release safety gate that was meant to block RSS/cold-start regressions; releases can ship while the perf job is red, though the documented failure is artifact-related not product-related.
> 
> **Overview**
> **Unblocks releases** by decoupling `daemon-perf-gate` from publish jobs: `finalize` and `npm-publish` no longer list it in `needs:`, and the explicit `needs.daemon-perf-gate.result == 'success'` check was removed from `npm-publish`'s `always()` condition.
> 
> The **daemon perf job still runs** and can fail red for visibility; only the hard release block is lifted. Workflow comments document this as **temporary (2026-07-14)**: the gate is failing on a **CI harness gap** (the `dist-cli` tarball omits `native/better_sqlite3.node`, so the staged daemon cannot load SQLite—not a shipped `.pkg` regression). **Fix forward** is to bundle the native module (or set `BETTER_SQLITE3_BINDING` in staging), then restore `daemon-perf-gate` on `finalize`/`npm-publish` `needs:` and the npm `if:` clause.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f953d7b7cbd6ef8dd36ca0b3a43f3eb0cb262900. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->


## v2026.7.9 - 2026-07-13


### New

- **Remote MCP server visibility.** AgenShield can now detect remote MCP servers used over the network, report their tool inventories to the dashboard, and mark servers that cannot be inspected because they reject inspection certificates.

### Improved

- **Faster, more reliable upgrades.** `agenshield install` and `agenshield upgrade` now download the signed macOS package from the AgenShield asset CDN first, verify it, and fall back automatically if needed.
- **Stronger policy integrity checks.** Policy bundles are now signature-verified before macOS enforcement components use them, with downgrade protection to prevent older unsigned policy data from being accepted.
- **More reliable process attribution.** AgenShield now tracks agent and network activity more accurately when macOS process IDs are reused, parent processes exit, or agents were already running before AgenShield started.

### Fixed

- **MCP tool inventories appear correctly.** Fixed several issues that could show MCP servers in the dashboard with empty tool lists, including large tool responses and both JSON and event-stream MCP transports.
- **MCP inspection no longer breaks TLS connections.** Fixed certificate generation and hostname recovery issues that could cause certificate-name errors, reset inspected MCP traffic, or require users to restart terminal sessions.
- **Existing TLS connections no longer hang during inspection.** Connections that cannot safely be inspected now pass through promptly instead of waiting around 30 seconds for handshake data that will never arrive.
- **Denied host agents are enforced.** Explicit host-scoped deny policies now block matching agents launched directly on the host, including root launches, and stop already-running matching agents while preserving system-process protections.
- **Inspection certificates stay trusted for spawned agents.** Fixed a race that could leave an agent with a stale AgenShield inspection CA file and cause certificate verification failures.
- **Process enforcement events are accurate.** AgenShield no longer reports a process as killed when macOS refused the termination or the process continued running.

_macOS (Apple Silicon / arm64) only._



## v2026.7.8 - 2026-07-09


### Fixed

- **Monitor mode now observes agent network activity without blocking it.** Agent process protection no longer forces network enforcement when a policy bundle is set to monitor, so admins can build and review network envelopes without unexpectedly cutting off agent traffic.

- **Observe-only network handling is more reliable during startup and reloads.** If AgenShield loses track of an in-flight connection during startup, reload, or provider recovery, monitor mode now allows the flow to continue instead of treating it as a block.

- **The desktop dashboard no longer gets stuck as unauthorized on first launch.** After installation, the desktop app now waits for the daemon to finish starting and connects automatically instead of requiring a manual app restart.

_macOS (Apple Silicon / arm64) only._



## v2026.7.7 - 2026-07-08


### Fixed

- **Certificate and keychain setup is more reliable on macOS 26.5 and later.** AgenShield now runs certificate-authority and Keychain operations through the signed app bundle, preventing macOS from terminating them during certificate generation, updates, and uninstall cleanup; transient launch failures during setup are retried automatically.

_macOS (Apple Silicon / arm64) only._



## v2026.7.6 - 2026-07-07


### Fixed

- **TLS inspection setup is more reliable after install or login.** AgenShield now retries a transient macOS helper launch failure during CA generation, reducing cases where trusted certificate setup was delayed until a later policy refresh.

_macOS (Apple Silicon / arm64) only._



## v2026.7.4 - 2026-07-07


### New

- **Lightweight MDM deployment package:** Admins can now push a small bootstrap installer instead of the full AgenShield installer. The endpoint downloads and verifies the full package itself, supports pinned versions from managed preferences, refuses downgrades, and runs headlessly for MDM installs.
- **MDM inventory correlation:** Enrollment now reports the device hardware serial number and whether AgenShield was provisioned by MDM or installed manually, helping admins match AgenShield installs to Intune or Jamf device records.
- **First-party release downloads:** AgenShield release artifacts can now be served from a first-party download endpoint with GitHub Releases as a fallback, making enterprise egress allowlisting easier.

### Improved

- **Update progress is more accurate:** Dashboard-initiated upgrades now receive structured progress with real download percentages and clearer lifecycle phases, so the update experience is less dependent on log-message guessing.
- **Upgrade failures are surfaced correctly:** Upgrade flows now report failed update steps and background-service restart failures as real failures instead of appearing successful.

### Fixed

- **Hardware serials backfill reliably:** macOS health reporting now reads serial numbers from a source that includes them, so existing enrolled devices can report serials on heartbeat without re-enrollment.

_macOS (Apple Silicon / arm64) only._



## v2026.7.3 - 2026-07-06


### New

- **Background update checks and install prompts.** AgenShield now checks for new releases while the dashboard is closed, shows update availability in the menu bar, and lets users start installation from the notification or popover.
- **Admin-driven endpoint updates.** Endpoints now support automatic updates and signed cloud-initiated update commands, including version-pinned rollout or rollback workflows.
- **Richer menu bar status.** The menu bar popover now shows protection posture, cloud and daemon state, open alerts, detected agents, protected resources, and live system metrics in one view.

### Improved

- **Granular monitor-mode controls.** Security admins can move specific enforcement actions into observe-only mode while still seeing what would have been denied or killed.
- **Enforcement actions are easier to audit.** Endpoint denies and kills now create structured alerts with appropriate severity instead of appearing only in local logs.
- **Activity views load faster on busy endpoints.** Profile-specific activity history now scales with the selected profile rather than the full activity table.
- **More resilient managed installs.** MDM and first-login activation flows are better at completing system extension setup and recovering the network protection layer when macOS reports an incomplete or stale extension state.

### Fixed

- **Managed Macs no longer show a generic “sh” background item.** AgenShield’s certificate-trust helper is now attributed to the signed AgenShield binary, so Login Items and background-item prompts identify it as AgenShield.
- **Fewer false positives on source-code filenames.** Files such as code or documentation with names containing words like “token” or “password” are no longer treated as secrets solely because of the filename, while exact secret files, key files, sensitive folders, and configured sensitive patterns remain protected.
- **Security hardening.** Network filtering now keeps the last known good protected-user configuration after a failed or tampered reload, and configuration signature handling is stricter.
- **Long-lived network sessions survive policy refreshes more reliably.** Reused connections such as streaming HTTP and MCP traffic are no longer dropped simply because one direction of the flow completed.
- **Update preferences now persist correctly.** The auto-update setting is saved reliably instead of being hidden behind older duplicate configuration rows.

_macOS (Apple Silicon / arm64) only._



## v2026.7.2 - 2026-07-04


### New

- **Zero-touch MDM deployment:** Admins can now deploy AgenShield with managed preferences, approval profiles, and the signed installer in any order; endpoints enroll and activate without a user present.
- **Passwordless in-app upgrades:** The desktop app can now start upgrades through the privileged daemon, show upgrade progress, and surface upgrade logs when troubleshooting is needed.
- **MCP server visibility:** The desktop app now has a dedicated MCP servers view, and AgenShield can detect configured, launched, and observed MCP servers more reliably.
- **MCP inspection groundwork:** AgenShield can now capture MCP server identity and tool inventory from inspected traffic without collecting tool results.
- **Support system status:** The Support page now includes a collapsible system status snapshot with daemon, extension, proxy, certificate, enrollment, and recent crash details for admins.

### Improved

- **Dashboard navigation is clearer:** Agents, policies, workspaces, MCP servers, resources, events, and support information are now separated into focused views with cleaner summaries.
- **Agent posture is easier to read:** The Agents page now combines detection, shielding, managed status, and run-control posture in one table instead of duplicating rows.
- **Workspace inventory is more accurate:** Nested project folders now roll up under their parent workspace, and workspaces discovered by resource scanning appear even when no grant exists.
- **Managed policies are less noisy:** Resource approval rules are hidden from the policy summaries and remain visible in the resource-focused views where they belong.
- **Resource usage telemetry is quieter:** Repeated resource usage observations are batched so cloud feeds show useful activity without flooding admins with many same-second entries.
- **Upgrade feedback is clearer:** CLI downloads now show stable progress, desktop upgrades preserve useful log output, and retry attempts keep the intended target version.
- **Installer and diagnostics output is cleaner:** Install scripts avoid misleading terminal errors, hide stale system-extension rows, and diagnostics better report certificate trust and relevant logs.

### Fixed

- **In-app upgrades now verify the installed version.** AgenShield no longer reports “Upgrade complete” when the requested version was not actually installed.
- **Upgrade cutover is more reliable.** Upgrades now better handle launchd timing so the daemon is not left unloaded after replacing an installed version.
- **Installed agents are detected correctly.** Agents that are installed but idle no longer appear as “not detected,” and filesystem rules no longer incorrectly change whether an agent is allowed to run.
- **Security hardening:** AgenShield now detects pressure from macOS code-signing checks and backs off safely, preventing enforcement sweeps from stalling host login or normal process launches.
- **MCP reports reach the cloud after startup.** MCP detections and resource reports seen before cloud sync is ready are queued and flushed instead of being dropped.
- **MCP inventory no longer merges distinct servers.** Servers that share a URL but differ by configuration or credentials remain separate, and multiple source locations are preserved.
- **MCP and workspace scans cover more layouts.** AgenShield now finds MCP configs and skills in more workspace roots, including sibling repos and parent folders that do not use git markers.
- **Certificate handling is safer.** Concurrent certificate authority loading no longer risks mismatched certificate/key pairs that could break inspected TLS connections.
- **False enforcement on AgenShield’s own checks is avoided.** The enforcer no longer kills daemon-spawned agent version probes under root-scoped rules.
- **Agent filters and UI controls behave better.** The Agents page no longer shows a false “No agents match” while detection is still loading, and banners, buttons, sidebar text, and window dragging have been polished.

_macOS (Apple Silicon / arm64) only._



## v2026.7.0 - 2026-07-01


### New

- **MCP activity visibility:** AgenShield now detects Model Context Protocol (MCP) server launches and MCP-over-HTTP activity, including tool calls, so admins can see which agents are using which MCP servers and tools. This is observe-only and records tool names, not tool arguments or results.
- **Workspace dependency inventory:** AgenShield now reports each discovered workspace’s declared npm dependencies and detected package manager, giving admins better context about what agents are working with.
- **Agent resource usage signals:** AgenShield now tracks how often agent skills, rules, instructions, and related resources are observed, including user-level resources, so admins can identify the most-used resources by agent.

### Improved

- **Lower-downtime upgrades:** macOS package upgrades now keep the daemon, menu bar app, and privilege helper running through most of the install, then perform a single cutover near the end. This reduces the upgrade interruption window from the full install period to a short restart.
- **Clearer menu bar health:** The menu bar now shows cloud-link health for enrolled devices, surfaces unhealthy sync status in the header, and offers a direct Full Disk Access settings shortcut when Endpoint Security is not functional.
- **More useful health reporting:** Health checks now include the specific unhealthy components that caused a warning, making dashboard status easier to diagnose.
- **Clearer network activity labels:** SNI-less or IP-literal network flows can now be labeled with the matching DNS hostname when available, so shadowed destinations are easier to understand.
- **Security hardening:** Upgrades now require trusted Frontegg-signed packages, mandatory production checksums, HTTPS-only redirects, safer enrollment-file handling, bounded MCP parsing, spoof-resistant MCP direction checks, rate limits, and log sanitization.

### Fixed

- **Daemon slowdown from stale process tracking:** AgenShield now prunes dead process records more reliably, preventing process-tree growth that could stall the daemon event loop and slow agent launches.
- **Failed upgrades no longer look successful:** The CLI now verifies that the daemon restarted on the expected version after a package upgrade and reports recovery steps if the cutover did not complete.
- **Cloud sync no longer stalls on missing home directories:** Local user sync now always supplies a usable home directory, avoiding sync rejection that could leave devices stuck in an “awaiting first device” or disconnected cloud-link state.
- **User attribution for telemetry is more accurate:** Telemetry now uses the correct environment vendor identity and refreshes user attribution from the current session token when available.
- **User-level skill usage now appears in usage rankings:** Global and user-scoped skills and rules are now counted in resource usage telemetry, not only workspace-scoped resources.

_macOS (Apple Silicon / arm64) only._



## v2026.7.1 - 2026-07-01


### New

- **MCP activity visibility:** AgenShield now detects Model Context Protocol (MCP) server launches and MCP-over-HTTP activity, including tool calls, so admins can see which agents are using which MCP servers and tools. This is observe-only and records tool names, not tool arguments or results.
- **Workspace dependency inventory:** AgenShield now reports each discovered workspace’s declared npm dependencies and detected package manager, giving admins better context about what agents are working with.
- **Agent resource usage signals:** AgenShield now tracks how often agent skills, rules, instructions, and related resources are observed, including user-level resources, so admins can identify the most-used resources by agent.

### Improved

- **Lower-downtime upgrades:** macOS package upgrades now keep the daemon, menu bar app, and privilege helper running through most of the install, then perform a single cutover near the end. This reduces the upgrade interruption window from the full install period to a short restart.
- **Clearer menu bar health:** The menu bar now shows cloud-link health for enrolled devices, surfaces unhealthy sync status in the header, and offers a direct Full Disk Access settings shortcut when Endpoint Security is not functional.
- **More useful health reporting:** Health checks now include the specific unhealthy components that caused a warning, making dashboard status easier to diagnose.
- **Clearer network activity labels:** SNI-less or IP-literal network flows can now be labeled with the matching DNS hostname when available, so shadowed destinations are easier to understand.
- **Security hardening:** Upgrades now require trusted Frontegg-signed packages, mandatory production checksums, HTTPS-only redirects, safer enrollment-file handling, bounded MCP parsing, spoof-resistant MCP direction checks, rate limits, and log sanitization.

### Fixed

- **Daemon slowdown from stale process tracking:** AgenShield now prunes dead process records more reliably, preventing process-tree growth that could stall the daemon event loop and slow agent launches.
- **Failed upgrades no longer look successful:** The CLI now verifies that the daemon restarted on the expected version after a package upgrade and reports recovery steps if the cutover did not complete.
- **Cloud sync no longer stalls on missing home directories:** Local user sync now always supplies a usable home directory, avoiding sync rejection that could leave devices stuck in an “awaiting first device” or disconnected cloud-link state.
- **User attribution for telemetry is more accurate:** Telemetry now uses the correct environment vendor identity and refreshes user attribution from the current session token when available.
- **User-level skill usage now appears in usage rankings:** Global and user-scoped skills and rules are now counted in resource usage telemetry, not only workspace-scoped resources.

_macOS (Apple Silicon / arm64) only._



## v2026.6.6 - 2026-06-29


### New

- **In-app updates:** The desktop dashboard now shows available releases, links to release notes, and can start an AgenShield upgrade through the native macOS admin prompt.

### Improved

- **Security hardening:** AgenShield now keeps the last valid enforcement policy active if a reload fails, refuses to mark failed policy deliveries as applied, tightens local request identity checks, fails closed when TLS inspection keys cannot load unexpectedly, and reduces sensitive cloud-sync detail in default logs.
- **More reliable enforcement under load:** Policy and configuration reloads are safer during concurrent activity, host process attribution is cached more efficiently, and high-volume event reporting now applies backpressure instead of allowing unbounded memory growth.
- **Faster TLS inspection:** Generated inspection certificates now use a lower-latency key type, reducing connection overhead when new per-site certificates are minted.
- **More accurate cloud reporting:** AgenShield now reports the logged-in Mac user more reliably, sends telemetry under the correct tenant identity, and uses the correct per-application sign-in host during authentication.
- **MCP monitoring updates without restart:** Newly added or removed cloud-managed agent profiles are reflected in MCP monitoring after policy updates, without requiring a daemon restart.

### Fixed

- **Claude Code settings stay readable:** AgenShield no longer leaves Claude Code settings owned or permissioned in a way that prevents the signed-in user from reading them, and it heals existing affected files.
- **Update retry controls recover sooner:** If an upgrade is already in progress, the dashboard no longer disables update controls for a full fresh update window before allowing a real retry.
- **Sensitive-file matching is more accurate:** Sensitive filenames and extensions are now matched case-insensitively, while broad secret-related substring checks are scoped more narrowly to avoid unnecessary enforcement work on unrelated paths.
- **Process tracing is more stable:** Running process start times are parsed correctly on macOS, preventing long-running agent sessions from being split into separate traces during reseeding.

_macOS (Apple Silicon / arm64) only._



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

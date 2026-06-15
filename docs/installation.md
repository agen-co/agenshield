# Installation

AgenShield installs on macOS as a signed, notarized `.pkg` that contains the CLI,
the background daemon, the menu-bar app, and the EndpointSecurity +
NetworkExtension system extensions. The installer is downloaded from this repo's
[Releases](https://github.com/agen-co/agenshield/releases) and verified against
the published `checksums.sha256`.

## Requirements

- macOS 14 (Sonoma) or later, on Apple Silicon
- Administrator (sudo) access — the system extensions install at the system level

## Install

### From the Frontegg dashboard (recommended)

AgenShield is deployed from your organization's **AgenShield workspace** in the
Frontegg dashboard:

1. Sign in at **[portal.frontegg.com](https://portal.frontegg.com)** and open **AgenShield**.
2. Create a deployment **campaign** — it generates a one-line install command that
   carries your enrollment token.
3. Run it on the endpoint:

```bash
curl -fsSL '<YOUR_INSTALL_URL>' | bash
```

The installer downloads the signed `.pkg` from this repo's
[Releases](https://github.com/agen-co/agenshield/releases), verifies it against
`checksums.sha256`, installs it, and enrolls the device.

### Via npm

With the cloud URL and token from your workspace:

```bash
npx agenshield install --cloud-url <CLOUD_URL> --token <ENROLLMENT_TOKEN>
agenshield start
```

### Pin a specific version

Append `--version` to the install command:

```bash
curl -fsSL '<YOUR_INSTALL_URL>' | bash -s -- --version <X.Y.Z>
```

## What gets installed

| Path | Purpose |
| --- | --- |
| `/Library/AgenShield/` | Daemon, broker, and CLI binaries |
| `/Applications/AgenShield.app` | Menu-bar app + system extensions |
| `/usr/local/bin/agenshield` | The `agenshield` CLI, on your `PATH` |

The daemon starts at boot via a macOS LaunchDaemon.

## Approve the system extensions

On first install, macOS asks you to allow the AgenShield system extensions in
**System Settings → Privacy & Security**. Approve them so kernel-level
enforcement can run. `agenshield doctor` reports anything still pending approval.

## First run

```bash
agenshield start      # start the daemon (if it isn't already running)
agenshield login      # link your account (opens a browser)
agenshield status     # confirm everything is healthy
```

Continue with **[Usage](./usage.md)**.

## Upgrade

```bash
agenshield upgrade                  # latest release
agenshield upgrade --version <X.Y.Z>
```

## Uninstall

```bash
agenshield uninstall
```

This stops the daemon, removes the system extensions, and deletes the installed
files.

<div align="center">

# 🛡️ AgenShield

### Endpoint security & policy enforcement for AI coding agents

**[agen.co](https://agen.co)** — by [Frontegg](https://frontegg.com)

[![Latest release](https://img.shields.io/github/v/release/agen-co/agenshield?sort=semver&display_name=tag&label=latest&color=0F766E)](https://github.com/agen-co/agenshield/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-555.svg)](#-install)
[![Get started](https://img.shields.io/badge/get%20started-portal.frontegg.com-0F766E.svg)](https://portal.frontegg.com)

</div>

---

AgenShield keeps AI coding agents — Claude Code, OpenClaw, and others — inside the
guardrails your organization sets. A local daemon plus macOS **EndpointSecurity**
and **NetworkExtension** system extensions enforce, at the kernel level, exactly
what an agent may **execute**, **read**, and **connect to** — all driven by policy
you manage centrally from the cloud.

> **ℹ️ About this repository**
> AgenShield is a commercial product with a **closed source**. This public
> repository is its home for **documentation, the changelog, and signed release
> downloads** — it does not contain the product source. Learn more at
> **[agen.co](https://agen.co)**.

## ✨ What it does

| Capability | What it enforces |
| --- | --- |
| 🚦 **Process control** | Allow or deny what an agent may execute — enforced in the kernel via EndpointSecurity. |
| 📁 **File guardrails** | Block reads/writes to sensitive paths: `.env`, SSH keys, credentials, tokens. |
| 🌐 **Network policy** | Allowlist outbound connections, with TLS-terminating inspection. |
| 🧩 **Skills & MCP** | Quarantine unapproved agent skills; govern Model Context Protocol servers. |
| ⚙️ **Managed settings** | Push organization config to Claude Code and other agents — users can't override it. |
| 📊 **Telemetry & alerts** | Stream policy violations and security events to AgenShield Cloud. |

## 🚀 Install

AgenShield is deployed from your organization's **AgenShield workspace** in the
Frontegg dashboard. Sign in at **[portal.frontegg.com](https://portal.frontegg.com)**,
open **AgenShield**, create a deployment campaign, and run the one-line install
command it gives you — it carries your enrollment token:

```bash
curl -fsSL '<YOUR_INSTALL_URL>' | bash
```

Prefer npm? Use the cloud URL + token from your workspace:

```bash
npx agenshield install --cloud-url <CLOUD_URL> --token <TOKEN>
agenshield start
```

Either way, the installer pulls the signed, notarized `.pkg` straight from this
repo's [**Releases**](https://github.com/agen-co/agenshield/releases) and verifies
it against the published `checksums.sha256`. Requires macOS 14+ (Apple Silicon).

## 📚 Documentation

Guides live in [`docs/`](./docs):

- [**Installation**](./docs/installation.md) — install, enroll, and uninstall on macOS
- [**Usage**](./docs/usage.md) — start the daemon, sign in, and what's enforced
- [**CLI reference**](./docs/cli.md) — every `agenshield` command

## 📦 Releases

Each release attaches a signed macOS installer to a
[GitHub Release](https://github.com/agen-co/agenshield/releases). The full,
versioned history is in [`CHANGELOG.md`](./CHANGELOG.md).

## 💬 Support

- 🐛 [Open an issue](https://github.com/agen-co/agenshield/issues)
- 🌐 [agen.co](https://agen.co)
- ✉️ [support@frontegg.com](mailto:support@frontegg.com)

---

<div align="center">

**[AgenShield](https://agen.co)** — built by **[Frontegg](https://frontegg.com)**

© Frontegg LTD · Licensed under [Apache-2.0](./LICENSE)

</div>

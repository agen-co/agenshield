# CLI Reference

Every command runs as `agenshield <command>`. Use `agenshield --help` or
`agenshield <command> --help` for the full set of options.

## Common commands

| Command | Description |
| --- | --- |
| `install` | Install AgenShield (downloads + runs the signed installer). Options: `--cloud-url`, `--token`, `--org`, `--version`. |
| `start` | Start the background daemon. |
| `stop` | Stop the daemon. |
| `status` | Show daemon, enrollment, and enforcement status. |
| `login` | Link this device to your AgenShield workspace (browser sign-in). |
| `upgrade` | Upgrade to the latest release, or a pinned `--version <X.Y.Z>`. |
| `doctor` | Diagnose installation, system-extension, and daemon health. |
| `logs` | Show recent daemon activity. |
| `uninstall` | Stop the daemon, remove the system extensions, and delete installed files. |

## Global options

These work on any command:

| Option | Effect |
| --- | --- |
| `--json` | Machine-readable JSON output. |
| `-q`, `--quiet` | Suppress non-essential output. |
| `--no-color` | Disable colored output. |
| `--debug` | Verbose diagnostic output. |

> `agenshield --help` lists every command, including advanced ones not shown here.

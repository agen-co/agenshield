## ✅ ROADMAP

[x] Support Keychain delegation with Touch ID
[ ] Add support for a local MCP server that will be injected into Claude Code, which will request specific permissions for accessing code or keys for a limited time
[ ] Add support for injecting the Agen-Co MCP server into the new architecture
[x] Add support for read-only and read/write workspaces
[x] Fix issues and alerts triggered by running our own AgenShield scripts that produce false alerts due to naming conflicts, for example:
  - Target process running as user "davidfrontegg" (PID 6409): node /Users/davidfrontegg/.agenshield/bin/agenshield-prompt --title "AgenShield: Current directory is not in the allowed workspace paths: /Users/davidfrontegg/git/agen-shield" --option "Grant access to this folder" --option "Start in agent home (/Users/ash_claude_agent) instead" --option "Cancel" --cancel
[ ] support auto watch node/pip/brew/bash/npm folders to detect executable binaries to add them to the wrapper

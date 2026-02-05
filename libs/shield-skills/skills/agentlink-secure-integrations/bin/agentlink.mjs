#!/usr/bin/env node

/**
 * AgentLink CLI — thin wrapper around MCP tools (zero npm dependencies)
 *
 * Auth, integrations, and connection management are handled by the Shield UI.
 * This CLI forwards tool calls to the daemon's MCP passthrough endpoint.
 *
 * Usage:
 *   agentlink <tool-name> [json-input]
 *
 * Tools:
 *   search-tools                Search for tools by atomic action queries
 *   call-tool                   Execute a single tool
 *   list-connected-integrations List connected integrations
 */

const DAEMON_URL = process.env.AGENSHIELD_DAEMON_URL || 'http://localhost:6969';
const API_BASE = `${DAEMON_URL}/api`;

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function daemonRequest(tool, input) {
  const url = `${API_BASE}/agentlink/mcp/call`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, input }),
    });
  } catch {
    console.error('Error: Cannot connect to AgenShield daemon.');
    console.error('Make sure it is running: agenshield daemon start');
    process.exit(1);
  }

  return res.json();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const toolName = args[0];

  if (!toolName || toolName === '--help' || toolName === '-h') {
    console.log(`AgentLink — Secure MCP tool execution

Usage: agentlink <tool-name> [json-input]

Tools:
  search-tools                Search for tools by atomic action queries
  call-tool                   Execute a single tool
  list-connected-integrations List connected integrations

Examples:
  agentlink list-connected-integrations
  agentlink search-tools '{"queries":["send slack message"]}'
  agentlink call-tool '{"toolName":"slack_send_message","input":{"channel":"#general","text":"hello"}}'

Auth and integration management are handled by the Shield UI.`);
    process.exit(0);
  }

  // Parse optional JSON input
  let input = {};
  if (args[1]) {
    try {
      input = JSON.parse(args[1]);
    } catch {
      console.error('Error: input must be valid JSON');
      process.exit(1);
    }
  }

  const res = await daemonRequest(toolName, input);

  if (!res.success) {
    if (res.error === 'unauthorized') {
      console.error('Unauthorized: Session expired. Please re-authenticate via the Shield UI.');
      process.exit(1);
    } else if (res.error === 'auth_required') {
      const message = res.data?.message || 'Authentication required.';
      console.error(message);
      console.error('Connect integrations via the Shield UI: agenshield setup');
      if (res.data?.authUrl) {
        console.error(`Auth URL: ${res.data.authUrl}`);
      }
    } else {
      console.error(`Error: ${res.error}`);
    }
    process.exit(1);
  }

  console.log(JSON.stringify(res.data, null, 2));
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

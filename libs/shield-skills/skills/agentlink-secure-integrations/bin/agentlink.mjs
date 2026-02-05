#!/usr/bin/env node

/**
 * AgentLink CLI — skill execution only (zero npm dependencies)
 *
 * Auth, integrations, and connection management are handled by the Shield UI.
 * This CLI is used by the sandboxed agent to execute tools via the daemon API.
 *
 * Usage:
 *   agentlink run <integration> <tool> [json-params]
 *   agentlink list [integration]
 *   agentlink search <query> [--integration <name>]
 */

const DAEMON_URL = process.env.AGENSHIELD_DAEMON_URL || 'http://localhost:6969';
const API_BASE = `${DAEMON_URL}/api`;

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function daemonRequest(method, path, body) {
  const url = `${API_BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    console.error('Error: Cannot connect to AgenShield daemon.');
    console.error('Make sure it is running: agenshield daemon start');
    process.exit(1);
  }

  const data = await res.json();
  return data;
}

function formatJson(obj) {
  return JSON.stringify(obj, null, 2);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function runTool(integration, tool, paramsStr) {
  if (!integration || !tool) {
    console.error('Usage: agentlink run <integration> <tool> [json-params]');
    process.exit(1);
  }

  let params = {};
  if (paramsStr) {
    try {
      params = JSON.parse(paramsStr);
    } catch {
      console.error('Error: params must be valid JSON');
      process.exit(1);
    }
  }

  const res = await daemonRequest('POST', '/agentlink/tool/run', { integration, tool, params });

  if (!res.success) {
    if (res.error === 'auth_required') {
      const message = res.data?.message || 'Authentication required. Use the Shield UI to connect this integration.';
      console.error(message);
      if (res.data?.authUrl) {
        console.error(`Auth URL: ${res.data.authUrl}`);
      }
    } else {
      console.error(`Error: ${res.error}`);
    }
    process.exit(1);
  }

  console.log(formatJson(res.data));
}

async function listTools(integration) {
  const query = integration ? `?integration=${encodeURIComponent(integration)}` : '';
  const res = await daemonRequest('GET', `/agentlink/tool/list${query}`);
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const tools = res.data?.tools || res.data || [];
  if (!Array.isArray(tools) || tools.length === 0) {
    console.log('No tools found.');
    return;
  }

  // Group by integration
  const byIntegration = {};
  for (const t of tools) {
    const key = t.integration || 'unknown';
    if (!byIntegration[key]) byIntegration[key] = [];
    byIntegration[key].push(t);
  }

  for (const [integ, intTools] of Object.entries(byIntegration)) {
    console.log(`\n${integ}:`);
    for (const t of intTools) {
      console.log(`  ${t.tool} — ${t.description || ''}`);
    }
  }
}

async function searchTools(query, integration) {
  if (!query) {
    console.error('Usage: agentlink search <query> [--integration <name>]');
    process.exit(1);
  }
  let qs = `?query=${encodeURIComponent(query)}`;
  if (integration) qs += `&integration=${encodeURIComponent(integration)}`;

  const res = await daemonRequest('GET', `/agentlink/tool/search${qs}`);
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const tools = res.data?.tools || res.data || [];
  if (!Array.isArray(tools) || tools.length === 0) {
    console.log('No tools found.');
    return;
  }

  for (const t of tools) {
    const status = t.connected ? 'connected' : 'not connected';
    console.log(`  [${t.integration}] ${t.tool} (${status})`);
    if (t.description) console.log(`    ${t.description}`);
  }
}

// ─── CLI routing ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`AgentLink — Secure skill execution

Usage: agentlink <command> [options]

Commands:
  run <integration> <tool> [json-params]   Execute a tool
  list [integration]                       List available tools
  search <query> [--integration <name>]    Search for tools

Auth and integration management are handled by the Shield UI.`);
    process.exit(0);
  }

  switch (command) {
    case 'run':
      await runTool(args[1], args[2], args[3]);
      break;

    case 'list':
      await listTools(args[1]);
      break;

    case 'search': {
      let integration;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--integration' && args[i + 1]) {
          integration = args[++i];
        }
      }
      await searchTools(args[1], integration);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run: agentlink --help');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

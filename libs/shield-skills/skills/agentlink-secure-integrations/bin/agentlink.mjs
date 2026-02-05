#!/usr/bin/env node

/**
 * AgentLink CLI — thin wrapper (zero npm dependencies)
 *
 * Communicates with the AgenShield daemon API at http://localhost:6969/api/agentlink/*
 */

const DAEMON_URL = process.env.AGENSHIELD_DAEMON_URL || 'http://localhost:6969';
const API_BASE = `${DAEMON_URL}/api`;
const POLL_INTERVAL = 2000; // 2 seconds

// ─── HTTP helpers ────────────────────────────────────────────────────────────

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

// Lazily import child_process only when needed
async function openUrl(url) {
  const { exec } = await import('node:child_process');
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatJson(obj) {
  return JSON.stringify(obj, null, 2);
}

// ─── Auth commands ───────────────────────────────────────────────────────────

async function authLogin() {
  console.log('Starting AgentLink authentication...');

  const res = await daemonRequest('POST', '/agentlink/auth/start', { source: 'agent' });
  if (!res.success) {
    console.error(`Error: ${res.error || 'Failed to start auth flow'}`);
    process.exit(1);
  }

  const { authUrl } = res.data;
  console.log(`\nOpening browser for authentication...`);
  console.log(`If browser doesn't open, visit:\n  ${authUrl}\n`);
  await openUrl(authUrl);

  // Poll for completion
  console.log('Waiting for authentication...');
  for (let i = 0; i < 150; i++) {
    await sleep(POLL_INTERVAL);
    const status = await daemonRequest('GET', '/agentlink/auth/status');
    if (status.success && status.data.authenticated && !status.data.expired) {
      console.log('\nAuthentication successful!');
      console.log('Your credentials are stored securely in the AgentLink vault.');
      return;
    }
  }

  console.error('\nAuthentication timed out. Please try again.');
  process.exit(1);
}

async function authStatus() {
  const res = await daemonRequest('GET', '/agentlink/auth/status');
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const { authenticated, expired, expiresAt, connectedIntegrations } = res.data;

  if (!authenticated && !expired) {
    console.log('Status: Not authenticated');
    console.log('Run: agentlink auth login');
    return;
  }

  if (expired) {
    console.log('Status: Token expired');
    console.log(`Expired: ${expiresAt}`);
    console.log('Run: agentlink auth login');
    return;
  }

  console.log('Status: Authenticated');
  console.log(`Expires: ${expiresAt}`);
  if (connectedIntegrations.length > 0) {
    console.log(`Connected integrations: ${connectedIntegrations.join(', ')}`);
  }
}

async function authLogout() {
  const res = await daemonRequest('POST', '/agentlink/auth/logout');
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }
  console.log('Logged out. Integration tokens remain in the cloud vault.');
}

// ─── Tool commands ───────────────────────────────────────────────────────────

async function toolList(integration) {
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

async function toolSearch(query, integration) {
  if (!query) {
    console.error('Usage: agentlink tool search <query>');
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

async function toolRun(integration, tool, paramsStr) {
  if (!integration || !tool) {
    console.error('Usage: agentlink tool run <integration> <tool> [json-params]');
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

  // Handle auth_required — delegate to UI or browser
  if (!res.success && res.error === 'auth_required') {
    const authUrl = res.data?.authUrl;
    const message = res.data?.message || 'Authentication required.';
    console.log(message);
    if (authUrl) {
      console.log(`Complete in your dashboard or visit:\n  ${authUrl}\n`);
      await openUrl(authUrl);

      // Poll until authenticated, then retry
      console.log('Waiting for authentication...');
      for (let i = 0; i < 150; i++) {
        await sleep(POLL_INTERVAL);
        const status = await daemonRequest('GET', '/agentlink/auth/status');
        if (status.success && status.data.authenticated && !status.data.expired) {
          console.log('Authenticated! Retrying command...\n');
          const retry = await daemonRequest('POST', '/agentlink/tool/run', { integration, tool, params });
          if (!retry.success) {
            console.error(`Error: ${retry.error}`);
            process.exit(1);
          }
          console.log(formatJson(retry.data));
          return;
        }
      }
      console.error('\nAuthentication timed out.');
      process.exit(1);
    }
    process.exit(1);
  }

  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  console.log(formatJson(res.data));
}

// ─── Integration commands ────────────────────────────────────────────────────

async function integrationsList(category, search) {
  let qs = '';
  const parts = [];
  if (category) parts.push(`category=${encodeURIComponent(category)}`);
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  if (parts.length) qs = `?${parts.join('&')}`;

  const res = await daemonRequest('GET', `/agentlink/integrations${qs}`);
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const integrations = res.data?.integrations || res.data || [];
  if (!Array.isArray(integrations) || integrations.length === 0) {
    console.log('No integrations found.');
    return;
  }

  // Group by category
  const byCat = {};
  for (const i of integrations) {
    const cat = i.category || 'other';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(i);
  }

  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`\n${cat}:`);
    for (const i of items) {
      console.log(`  ${i.name} (${i.id}) — ${i.description || ''} [${i.toolsCount || 0} tools]`);
    }
  }
}

async function integrationsConnected() {
  const res = await daemonRequest('GET', '/agentlink/integrations/connected');
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const integrations = res.data?.integrations || res.data || [];
  if (!Array.isArray(integrations) || integrations.length === 0) {
    console.log('No connected integrations.');
    return;
  }

  for (const i of integrations) {
    const reauth = i.requiresReauth ? ' [re-auth needed]' : '';
    console.log(`  ${i.name} (${i.id}) — ${i.status}${reauth}`);
    if (i.account) console.log(`    Account: ${i.account}`);
    console.log(`    Connected: ${i.connectedAt}`);
  }
}

async function integrationsConnect(name, scopes) {
  if (!name) {
    console.error('Usage: agentlink integrations connect <name> [--scopes s1,s2]');
    process.exit(1);
  }

  const body = { integration: name };
  if (scopes) body.scopes = scopes.split(',').map((s) => s.trim());

  const res = await daemonRequest('POST', '/agentlink/integrations/connect', body);
  if (!res.success) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const data = res.data;
  if (data.status === 'already_connected') {
    console.log(`${name} is already connected.`);
    if (data.account) console.log(`Account: ${data.account}`);
    return;
  }

  if (data.status === 'auth_required') {
    console.log(`Authentication required for ${name}.`);
    if (data.oauthUrl) {
      console.log(`Opening browser...\n  ${data.oauthUrl}`);
      await openUrl(data.oauthUrl);
    }
    if (data.instructions) console.log(`\n${data.instructions}`);
    return;
  }

  if (data.status === 'connected') {
    console.log(`Successfully connected ${name}!`);
    if (data.account) console.log(`Account: ${data.account}`);
    return;
  }

  console.log(formatJson(data));
}

// ─── CLI routing ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const sub = args[1];

  if (!command || command === '--help' || command === '-h') {
    console.log(`AgentLink — Secure integrations gateway

Usage: agentlink <command> [subcommand] [options]

Commands:
  auth login          Authenticate with AgentLink gateway
  auth status         Check authentication status
  auth logout         Remove stored credentials

  tool list           List available tools
  tool search <q>     Search for tools by description
  tool run <int> <t>  Execute a tool (pass JSON params as 3rd arg)

  integrations list       List all available integrations
  integrations connected  List connected integrations
  integrations connect    Connect a new integration`);
    process.exit(0);
  }

  switch (command) {
    case 'auth':
      switch (sub) {
        case 'login':
        case undefined:
          await authLogin();
          break;
        case 'status':
        case '--status':
          await authStatus();
          break;
        case 'logout':
        case '--logout':
          await authLogout();
          break;
        default:
          console.error(`Unknown auth subcommand: ${sub}`);
          process.exit(1);
      }
      break;

    case 'tool':
      switch (sub) {
        case 'list':
          await toolList(args[2]);
          break;
        case 'search':
          await toolSearch(args[2], args[3]);
          break;
        case 'run':
          await toolRun(args[2], args[3], args[4]);
          break;
        default:
          console.error(`Unknown tool subcommand: ${sub}`);
          process.exit(1);
      }
      break;

    case 'integrations':
      switch (sub) {
        case 'list': {
          // Parse --category and --search flags
          let category, search;
          for (let i = 2; i < args.length; i++) {
            if (args[i] === '--category' && args[i + 1]) { category = args[++i]; }
            else if (args[i] === '--search' && args[i + 1]) { search = args[++i]; }
          }
          await integrationsList(category, search);
          break;
        }
        case 'connected':
          await integrationsConnected();
          break;
        case 'connect': {
          let scopes;
          for (let i = 3; i < args.length; i++) {
            if (args[i] === '--scopes' && args[i + 1]) { scopes = args[++i]; }
          }
          await integrationsConnect(args[2], scopes);
          break;
        }
        default:
          console.error(`Unknown integrations subcommand: ${sub}`);
          process.exit(1);
      }
      break;

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

/**
 * Integrations Command
 *
 * Manage third-party integrations via the AgenShield daemon.
 * All requests are forwarded through the daemon to the MCP Gateway.
 */

import { Command } from 'commander';
import open from 'open';
import {
  requireDaemon,
  integrationsList,
  integrationsConnected,
  integrationsConnect,
  type Integration,
} from '../lib/daemon-client.js';

/**
 * List all available integrations in the marketplace
 */
async function listAvailable(options: { category?: string; search?: string }): Promise<void> {
  await requireDaemon();

  console.log('\n  Fetching available integrations...\n');

  const result = await integrationsList(options.category, options.search);

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to list integrations'}\n`);
    process.exit(1);
  }

  const integrations = result.data.integrations || [];
  const totalCount = result.data.total_count || integrations.length;

  if (integrations.length === 0) {
    console.log('  No integrations found.\n');
    return;
  }

  console.log(`  Available Integrations (${totalCount} total):\n`);

  // Group by category
  const byCategory: Record<string, Integration[]> = {};
  for (const integration of integrations) {
    if (!byCategory[integration.category]) {
      byCategory[integration.category] = [];
    }
    byCategory[integration.category].push(integration);
  }

  for (const [category, categoryIntegrations] of Object.entries(byCategory)) {
    console.log(`  ${category.toUpperCase()}:`);
    for (const int of categoryIntegrations) {
      console.log(`    ${int.id.padEnd(20)} ${int.name} (${int.tools_count} tools)`);
      console.log(`    ${''.padEnd(20)} ${int.description}`);
    }
    console.log('');
  }

  console.log('  Connect an integration: agentlink integrations connect <name>\n');
}

/**
 * List connected integrations
 */
async function listConnected(): Promise<void> {
  await requireDaemon();

  console.log('\n  Fetching connected integrations...\n');

  const result = await integrationsConnected();

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to list connected integrations'}\n`);
    process.exit(1);
  }

  const integrations = result.data.integrations || [];

  if (integrations.length === 0) {
    console.log('  No integrations connected yet.');
    console.log('\n  Browse available integrations: agentlink integrations list');
    console.log('  Connect an integration: agentlink integrations connect <name>\n');
    return;
  }

  console.log('  Connected Integrations:\n');

  for (const int of integrations) {
    const status = int.requires_reauth ? '(needs re-auth)' : `(${int.status})`;
    const account = int.account ? ` - ${int.account}` : '';
    const date = new Date(int.connected_at).toLocaleDateString();

    console.log(`  ${int.id.padEnd(20)} ${int.name}${account}`);
    console.log(`  ${''.padEnd(20)} Connected: ${date} ${status}`);

    if (int.requires_reauth) {
      console.log(`  ${''.padEnd(20)} Refresh: agentlink integrations connect ${int.id}`);
    }
    console.log('');
  }
}

/**
 * Connect a new integration
 */
async function connectIntegration(
  integration: string,
  options: { scopes?: string }
): Promise<void> {
  await requireDaemon();

  console.log(`\n  Connecting ${integration}...\n`);

  const scopes = options.scopes
    ? options.scopes.split(',').map((s) => s.trim())
    : undefined;

  const result = await integrationsConnect(integration, scopes);

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to connect integration'}\n`);
    process.exit(1);
  }

  const data = result.data;

  if (data.status === 'already_connected') {
    console.log(`  ${integration} is already connected!`);
    if (data.account) {
      console.log(`  Account: ${data.account}`);
    }
    if (data.connected_at) {
      console.log(`  Connected: ${new Date(data.connected_at).toLocaleDateString()}`);
    }
    console.log('');
    return;
  }

  if (data.status === 'auth_required' && data.oauth_url) {
    console.log('  Opening browser for authentication...\n');
    console.log(`  If browser doesn't open, visit:\n  ${data.oauth_url}\n`);

    try {
      await open(data.oauth_url);
    } catch {
      console.log('  Could not open browser automatically.');
    }

    if (data.instructions) {
      console.log(`  ${data.instructions}\n`);
    }

    console.log('  After authenticating, you can use the integration with OpenClaw.');
    console.log(`  Verify connection: agentlink integrations connected\n`);
    return;
  }

  if (data.status === 'connected') {
    console.log(`  Successfully connected ${integration}!`);
    if (data.account) {
      console.log(`  Account: ${data.account}`);
    }
    console.log('');
    return;
  }

  console.log(`  Unexpected response: ${JSON.stringify(data)}\n`);
}

/**
 * Create the integrations command
 */
export function createIntegrationsCommand(): Command {
  const cmd = new Command('integrations')
    .description('Manage third-party integrations');

  cmd
    .command('list')
    .description('List all available integrations in the marketplace')
    .option('-c, --category <category>', 'Filter by category')
    .option('-s, --search <query>', 'Search integrations')
    .action(listAvailable);

  cmd
    .command('connected')
    .description('List your connected integrations')
    .action(listConnected);

  cmd
    .command('connect <integration>')
    .description('Connect a new integration (opens OAuth flow)')
    .option('--scopes <scopes>', 'Comma-separated OAuth scopes')
    .action(connectIntegration);

  return cmd;
}

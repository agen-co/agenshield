/**
 * Tool Command
 *
 * Execute tools from connected integrations via the AgenShield daemon.
 * All requests are forwarded through the daemon to the MCP Gateway.
 */

import { Command } from 'commander';
import {
  requireDaemon,
  toolRun,
  toolList,
  toolSearch,
  type Tool,
} from '../lib/daemon-client.js';

/**
 * List available tools from connected integrations
 */
async function listTools(options: { integration?: string }): Promise<void> {
  await requireDaemon();

  console.log('\n  Fetching available tools...\n');

  const result = await toolList(options.integration, true);

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to list tools'}\n`);
    process.exit(1);
  }

  const tools = result.data.tools || [];

  if (tools.length === 0) {
    console.log('  No tools available.');
    console.log('  Connect an integration first: agentlink integrations connect <name>\n');
    return;
  }

  console.log('  Available Tools:\n');

  // Group by integration
  const byIntegration: Record<string, Tool[]> = {};
  for (const tool of tools) {
    if (!byIntegration[tool.integration]) {
      byIntegration[tool.integration] = [];
    }
    byIntegration[tool.integration].push(tool);
  }

  for (const [integration, integrationTools] of Object.entries(byIntegration)) {
    console.log(`  ${integration}:`);
    for (const tool of integrationTools) {
      console.log(`    - ${tool.tool}: ${tool.description}`);
    }
    console.log('');
  }
}

/**
 * Search for tools by query
 */
async function searchTools(query: string, options: { integration?: string }): Promise<void> {
  await requireDaemon();

  console.log(`\n  Searching for "${query}"...\n`);

  const result = await toolSearch(query, options.integration);

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to search tools'}\n`);
    process.exit(1);
  }

  const tools = result.data.tools || [];

  if (tools.length === 0) {
    console.log('  No tools found matching your query.\n');
    return;
  }

  console.log('  Search Results:\n');

  for (const tool of tools) {
    const status = tool.connected ? '(connected)' : '(not connected)';
    console.log(`  ${tool.integration}/${tool.tool} ${status}`);
    console.log(`    ${tool.description}`);
    if (!tool.connected && tool.connect_url) {
      console.log(`    Connect: agentlink integrations connect ${tool.integration}`);
    }
    console.log('');
  }
}

/**
 * Execute a tool
 */
async function runTool(
  integration: string,
  tool: string,
  paramsArg?: string
): Promise<void> {
  await requireDaemon();

  console.log(`\n  Executing ${integration}/${tool}...\n`);

  // Parse params if provided
  let params: Record<string, unknown> = {};
  if (paramsArg) {
    try {
      params = JSON.parse(paramsArg);
    } catch {
      console.error('  Invalid JSON params. Use format: \'{"key": "value"}\'\n');
      process.exit(1);
    }
  }

  const result = await toolRun(integration, tool, params);

  if (!result.success) {
    const message = result.error || 'Tool execution failed';

    // Check for auth_required
    if (message.includes('auth_required')) {
      console.log(`  The ${integration} integration requires authentication.`);
      console.log(`\n  Run: agentlink integrations connect ${integration}\n`);
      process.exit(1);
    }

    console.error(`  Error: ${message}\n`);
    process.exit(1);
  }

  console.log('  Result:\n');
  console.log(JSON.stringify(result.data, null, 2));
  console.log('');
}

/**
 * Create the tool command
 */
export function createToolCommand(): Command {
  const cmd = new Command('tool')
    .description('Execute tools from connected integrations');

  cmd
    .command('list')
    .description('List available tools from connected integrations')
    .option('-i, --integration <name>', 'Filter by integration')
    .action(listTools);

  cmd
    .command('search <query>')
    .description('Search for tools by description')
    .option('-i, --integration <name>', 'Filter by integration')
    .action(searchTools);

  cmd
    .command('run <integration> <tool> [params]')
    .description('Execute a tool (params as JSON string)')
    .action(runTool);

  return cmd;
}

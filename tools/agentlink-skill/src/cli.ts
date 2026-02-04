/**
 * AgentLink CLI Entry Point
 */

import { Command } from 'commander';
import { createAuthCommand } from './commands/auth.js';
import { createToolCommand } from './commands/tool.js';
import { createIntegrationsCommand } from './commands/integrations.js';

const program = new Command();

program
  .name('agentlink')
  .description('Secure integrations gateway for OpenClaw')
  .version('0.1.0');

// Add commands
program.addCommand(createAuthCommand());
program.addCommand(createToolCommand());
program.addCommand(createIntegrationsCommand());

// Parse arguments
program.parse();

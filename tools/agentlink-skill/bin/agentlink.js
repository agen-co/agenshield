#!/usr/bin/env node
/**
 * AgentLink CLI
 *
 * Secure integrations gateway for OpenClaw.
 * Routes API calls through AgentLink's cloud vault to protect credentials.
 */

import('../dist/cli.js').catch((err) => {
  console.error('Failed to load AgentLink CLI:', err.message);
  console.error('Run "npm run build" in the agentlink-skill directory first.');
  process.exit(1);
});

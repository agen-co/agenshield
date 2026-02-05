/**
 * MCP client lifecycle manager
 *
 * Singleton management for the MCP client instance.
 */

import { MCPClient, type MCPConnectionState } from './client';
import { MCP_GATEWAY } from '@agenshield/ipc';
import {
  emitAgentLinkConnected,
  emitAgentLinkDisconnected,
} from '../events/emitter';

let mcpClient: MCPClient | null = null;

/**
 * Get the current MCP client instance (or null if not initialized)
 */
export function getMCPClient(): MCPClient | null {
  return mcpClient;
}

/**
 * Create and activate the MCP client.
 * @param daemonPort The port the daemon is listening on (for OAuth redirect_uri)
 * @returns { authUrl } if the user needs to complete OAuth in a browser
 */
export async function activateMCP(daemonPort: number): Promise<{ authUrl?: string }> {
  const gatewayUrl = `${MCP_GATEWAY}`;
  console.log(`\x1b[36m[MCP]\x1b[0m Activating MCP client → ${gatewayUrl}`);

  // Deactivate any existing client first
  if (mcpClient) {
    console.log(`\x1b[33m[MCP]\x1b[0m Deactivating existing client`);
    await mcpClient.deactivate();
  }

  mcpClient = new MCPClient(gatewayUrl, daemonPort);

  mcpClient.onStateChange = (state: MCPConnectionState) => {
    console.log(`\x1b[36m[MCP]\x1b[0m State changed → \x1b[1m${state}\x1b[0m`);
    if (state === 'connected') {
      emitAgentLinkConnected();
    } else if (state === 'disconnected' || state === 'error') {
      emitAgentLinkDisconnected();
    }
  };

  try {
    const result = await mcpClient.activate();
    if (result.authUrl) {
      console.log(`\x1b[33m[MCP]\x1b[0m Auth required — waiting for user`);
    } else {
      console.log(`\x1b[32m[MCP]\x1b[0m Client activated successfully`);
    }
    return result;
  } catch (err) {
    console.error(`\x1b[31m[MCP]\x1b[0m Activation failed: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Complete the OAuth flow with an authorization code.
 */
export async function finishMCPAuth(code: string): Promise<void> {
  if (!mcpClient) {
    throw new Error('MCP client not initialized. Call activateMCP() first.');
  }
  await mcpClient.finishAuth(code);
}

/**
 * Deactivate and destroy the MCP client
 */
export async function deactivateMCP(): Promise<void> {
  if (mcpClient) {
    console.log(`\x1b[36m[MCP]\x1b[0m Deactivating MCP client`);
    await mcpClient.deactivate();
    mcpClient = null;
  }
}

/**
 * Get the current MCP connection state
 */
export function getMCPState(): MCPConnectionState {
  if (!mcpClient) return 'disconnected';
  return mcpClient.getState();
}

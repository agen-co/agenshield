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
 * Create and activate the MCP client
 * @param getToken Async function that returns a valid access token
 */
export async function activateMCP(getToken: () => Promise<string>): Promise<void> {
  // Deactivate any existing client first
  if (mcpClient) {
    await mcpClient.deactivate();
  }

  mcpClient = new MCPClient({
    gatewayUrl: `${MCP_GATEWAY}/mcp`,
    getAccessToken: getToken,
  });

  mcpClient.onStateChange = (state: MCPConnectionState) => {
    if (state === 'connected') {
      emitAgentLinkConnected();
    } else if (state === 'disconnected' || state === 'error') {
      emitAgentLinkDisconnected();
    }
  };

  await mcpClient.activate();
}

/**
 * Deactivate and destroy the MCP client
 */
export async function deactivateMCP(): Promise<void> {
  if (mcpClient) {
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

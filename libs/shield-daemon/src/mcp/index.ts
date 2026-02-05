/**
 * MCP module exports
 */

export { MCPClient } from './client';
export type { MCPConnectionState, MCPClientConfig, MCPTool, MCPToolResult } from './client';
export { getMCPClient, activateMCP, deactivateMCP, getMCPState } from './state';

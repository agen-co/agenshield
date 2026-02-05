/**
 * MCP module exports
 */

export { MCPClient } from './client';
export type { MCPConnectionState, MCPTool, MCPToolResult } from './client';
export { getMCPClient, activateMCP, deactivateMCP, getMCPState, finishMCPAuth } from './state';

/**
 * MCP server events — registration, status changes, unauthorized detection, cloud sync.
 */

import { registerEventTypes } from './event-registry';

export interface McpServerAddedPayload {
  id: string;
  name: string;
  slug: string;
  transport: string;
  source: string;
}

export interface McpServerRemovedPayload {
  id: string;
  slug: string;
}

export interface McpServerStatusChangedPayload {
  id: string;
  slug: string;
  previousStatus: string;
  newStatus: string;
}

export interface McpUnauthorizedDetectedPayload {
  slug: string;
  configPath: string;
  transport: string;
  action: 'alert' | 'quarantine';
}

export interface McpConfigTamperedPayload {
  id: string;
  slug: string;
  configPath: string;
  changes: string[];
}

export interface McpCloudSyncPayload {
  source: string;
  added: number;
  removed: number;
  updated: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'mcp:server_added': McpServerAddedPayload;
    'mcp:server_removed': McpServerRemovedPayload;
    'mcp:server_status_changed': McpServerStatusChangedPayload;
    'mcp:unauthorized_detected': McpUnauthorizedDetectedPayload;
    'mcp:config_tampered': McpConfigTamperedPayload;
    'mcp:cloud_sync': McpCloudSyncPayload;
  }
}

export const MCP_EVENT_TYPES = [
  'mcp:server_added',
  'mcp:server_removed',
  'mcp:server_status_changed',
  'mcp:unauthorized_detected',
  'mcp:config_tampered',
  'mcp:cloud_sync',
] as const;

registerEventTypes(MCP_EVENT_TYPES);

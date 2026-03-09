/**
 * MCP Server domain types.
 *
 * MCP (Model Context Protocol) servers are config-based service connections
 * that can be registered, managed, and injected into target platform configs
 * (e.g. ~/.claude/settings.json). They support push from cloud policy servers
 * and workspace monitoring for unauthorized server detection.
 */

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpAuthType = 'none' | 'oauth' | 'apikey' | 'bearer';
export type McpSource = 'manual' | 'cloud' | 'agenco' | 'workspace';
export type McpServerStatus = 'active' | 'disabled' | 'pending' | 'blocked';

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  description: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  authType: McpAuthType;
  authConfig: Record<string, unknown> | null;
  source: McpSource;
  managed: boolean;
  managedSource: string | null;
  status: McpServerStatus;
  profileId: string | null;
  configJson: Record<string, unknown> | null;
  supportedTargets: string[];
  createdAt: string;
  updatedAt: string;
}

export interface McpServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpServerResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerCapabilities {
  tools: McpServerTool[];
  resources: McpServerResource[];
  prompts: McpServerPrompt[];
  probedAt: string;
  error?: string;
}

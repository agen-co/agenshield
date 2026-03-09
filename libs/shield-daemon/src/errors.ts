/**
 * Shield Daemon error classes
 *
 * Typed errors per CLAUDE.md conventions.
 */

export class DaemonError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DaemonError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when a target context is required but no profile exists in storage
 * and no AGENSHIELD_AGENT_HOME env var is set.
 */
export class TargetContextNotFoundError extends DaemonError {
  constructor(message?: string) {
    super(
      message ?? 'No target context available — no profile configured and AGENSHIELD_AGENT_HOME not set',
      'TARGET_CONTEXT_NOT_FOUND',
    );
    this.name = 'TargetContextNotFoundError';
  }
}

/**
 * Base error for workspace skill operations.
 */
export class WorkspaceSkillError extends DaemonError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'WorkspaceSkillError';
  }
}

/**
 * Thrown when a workspace skill record is not found by ID.
 */
export class WorkspaceSkillNotFoundError extends WorkspaceSkillError {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Workspace skill not found: ${skillId}`, 'WORKSPACE_SKILL_NOT_FOUND');
    this.name = 'WorkspaceSkillNotFoundError';
    this.skillId = skillId;
  }
}

/**
 * Thrown when an MCP server record is not found by ID or slug.
 */
export class McpServerNotFoundError extends DaemonError {
  readonly serverId: string;

  constructor(serverId: string) {
    super(`MCP server not found: ${serverId}`, 'MCP_SERVER_NOT_FOUND');
    this.name = 'McpServerNotFoundError';
    this.serverId = serverId;
  }
}

/**
 * Thrown when writing an MCP server entry to a target config file fails.
 */
export class McpConfigInjectionError extends DaemonError {
  readonly configPath: string;

  constructor(configPath: string, message?: string) {
    super(
      message ?? `Failed to inject MCP config into ${configPath}`,
      'MCP_CONFIG_INJECTION_FAILED',
    );
    this.name = 'McpConfigInjectionError';
    this.configPath = configPath;
  }
}

/**
 * Thrown when an unauthorized MCP server is detected in a workspace config.
 */
export class McpServerBlockedError extends DaemonError {
  readonly slug: string;

  constructor(slug: string) {
    super(`Unauthorized MCP server detected: ${slug}`, 'MCP_SERVER_BLOCKED');
    this.name = 'McpServerBlockedError';
    this.slug = slug;
  }
}

/**
 * Thrown when probing an MCP server's capabilities fails.
 */
export class McpProbeError extends DaemonError {
  readonly serverId: string;

  constructor(serverId: string, message?: string) {
    super(message ?? `Failed to probe MCP server: ${serverId}`, 'MCP_PROBE_FAILED');
    this.name = 'McpProbeError';
    this.serverId = serverId;
  }
}

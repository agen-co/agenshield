/**
 * Broker types and interfaces
 */

import type { PolicyRule, OperationType, FsConstraints, NetworkConstraints } from '@agenshield/ipc';

/**
 * Broker daemon configuration
 */
export interface BrokerConfig {
  /** Unix socket path */
  socketPath: string;

  /** Whether HTTP fallback is enabled */
  httpEnabled: boolean;

  /** HTTP fallback port */
  httpPort: number;

  /** HTTP fallback host (should be localhost) */
  httpHost: string;

  /** Path to configuration file */
  configPath: string;

  /** Path to policies directory */
  policiesPath: string;

  /** Path to audit log */
  auditLogPath: string;

  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Whether to fail open if policy check fails */
  failOpen: boolean;

  /** Socket file permissions (octal) */
  socketMode: number;

  /** Socket owner user */
  socketOwner?: string;

  /** Socket owner group */
  socketGroup?: string;

  /** Agent home directory (for fs policy paths) */
  agentHome?: string;

  /** Daemon RPC URL for policy forwarding (default: http://127.0.0.1:5200) */
  daemonUrl?: string;

  /** Profile ID for this broker instance */
  profileId?: string;

  /** Broker authentication token for daemon RPC */
  profileToken?: string;

  /** Path to per-profile daemon socket */
  daemonSocketPath?: string;
}

/**
 * Context passed to operation handlers
 */
export interface HandlerContext {
  /** Request ID for tracing */
  requestId: string;

  /** Channel the request came from */
  channel: 'socket' | 'http';

  /** Client user ID (from socket credentials) */
  clientUid?: number;

  /** Client group ID (from socket credentials) */
  clientGid?: number;

  /** Client process ID */
  clientPid?: number;

  /** Timestamp of request */
  timestamp: Date;

  /** Broker configuration */
  config: BrokerConfig;
}

/**
 * Result from an operation handler
 */
export interface HandlerResult<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;

  /** Result data (if successful) */
  data?: T;

  /** Error information (if failed) */
  error?: {
    code: number;
    message: string;
    details?: unknown;
  };

  /** Audit metadata */
  audit?: {
    duration: number;
    policyMatched?: string;
    bytesTransferred?: number;
  };
}

/**
 * Audit log entry
 */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;

  /** Timestamp */
  timestamp: Date;

  /** Operation type */
  operation: OperationType;

  /** Request channel */
  channel: 'socket' | 'http';

  /** Client user ID */
  clientUid?: number;

  /** Whether operation was allowed */
  allowed: boolean;

  /** Policy that matched (if any) */
  policyId?: string;

  /** Operation target (URL, path, command) */
  target: string;

  /** Operation result */
  result: 'success' | 'denied' | 'error';

  /** Error message if failed */
  errorMessage?: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Secret vault entry
 */
export interface VaultEntry {
  /** Secret name */
  name: string;

  /** Encrypted value */
  encryptedValue: string;

  /** Operations that can access this secret */
  allowedOperations: OperationType[];

  /** Created timestamp */
  createdAt: Date;

  /** Last accessed timestamp */
  lastAccessedAt?: Date;

  /** Access count */
  accessCount: number;
}

/**
 * JSON-RPC 2.0 request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: OperationType;
  params: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * JSON-RPC 2.0 error
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Operation-specific parameter types
 */
export interface HttpRequestParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeout?: number;
  followRedirects?: boolean;
}

export interface HttpRequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface FileReadParams {
  path: string;
  encoding?: BufferEncoding;
}

export interface FileReadResult {
  content: string;
  size: number;
  mtime: string;
}

export interface FileWriteParams {
  path: string;
  content: string;
  encoding?: BufferEncoding;
  mode?: number;
}

export interface FileWriteResult {
  bytesWritten: number;
  path: string;
}

export interface FileListParams {
  path: string;
  recursive?: boolean;
  pattern?: string;
}

export interface FileListResult {
  entries: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory' | 'symlink';
    size: number;
    mtime: string;
  }>;
}

export interface ExecParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: boolean;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
}

export interface OpenUrlParams {
  url: string;
  browser?: string;
}

export interface OpenUrlResult {
  opened: boolean;
}

export interface SecretInjectParams {
  name: string;
  targetEnv?: string;
}

export interface SecretInjectResult {
  value: string;
  injected: boolean;
}

export interface PingParams {
  echo?: string;
}

export interface PingResult {
  pong: true;
  echo?: string;
  timestamp: string;
  version: string;
}

/**
 * Skill installation file
 */
export interface SkillInstallFile {
  /** Relative file name (e.g., "skill.md", "lib/utils.js") */
  name: string;
  /** File content (base64 encoded for binary, raw string for text) */
  content: string;
  /** Optional file mode (e.g., 0o755 for executable) */
  mode?: number;
  /** Whether content is base64 encoded */
  base64?: boolean;
}

export interface SkillInstallParams {
  /** Skill slug (used as directory name) */
  slug: string;
  /** Files to install */
  files: SkillInstallFile[];
  /** Whether to create a wrapper script in bin directory */
  createWrapper?: boolean;
  /** Agent home directory (defaults to env AGENSHIELD_AGENT_HOME) */
  agentHome?: string;
  /** Socket group name (defaults to env AGENSHIELD_SOCKET_GROUP) */
  socketGroup?: string;
}

export interface SkillInstallResult {
  /** Whether installation succeeded */
  installed: boolean;
  /** Path to installed skill directory */
  skillDir: string;
  /** Path to wrapper script (if created) */
  wrapperPath?: string;
  /** Number of files written */
  filesWritten: number;
  /** Non-fatal warnings (e.g., chown failures in dev) */
  warnings?: string[];
}

export interface SkillUninstallParams {
  /** Skill slug to uninstall */
  slug: string;
  /** Agent home directory (defaults to env AGENSHIELD_AGENT_HOME) */
  agentHome?: string;
  /** Whether to remove wrapper script */
  removeWrapper?: boolean;
}

export interface SkillUninstallResult {
  /** Whether uninstallation succeeded */
  uninstalled: boolean;
  /** Path to removed skill directory */
  skillDir: string;
  /** Whether wrapper was removed */
  wrapperRemoved: boolean;
}

export interface PolicyCheckParams {
  /** Operation type to check */
  operation: OperationType;
  /** Target command/path/url to check */
  target: string;
}

export interface PolicyCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Policy ID that matched (if any) */
  policyId?: string;
  /** Human-readable reason */
  reason?: string;
}

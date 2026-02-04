/**
 * Broker operation types
 *
 * JSON-RPC 2.0 based protocol for broker communication.
 */

/**
 * Operation types supported by the broker
 */
export type OperationType =
  | 'http_request'
  | 'file_read'
  | 'file_write'
  | 'file_list'
  | 'exec'
  | 'command_execute'
  | 'open_url'
  | 'secret_inject'
  | 'ping'
  | 'policy_check';

/**
 * JSON-RPC 2.0 request
 */
export interface BrokerRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: OperationType;
  params: OperationParams;
  /** Track request origin */
  channel?: 'socket' | 'http';
}

/**
 * JSON-RPC 2.0 response
 */
export interface BrokerResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: BrokerError;
}

/**
 * JSON-RPC 2.0 error
 */
export interface BrokerError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Union type for all operation parameters
 */
export type OperationParams =
  | HttpRequestParams
  | FileReadParams
  | FileWriteParams
  | FileListParams
  | ExecParams
  | OpenUrlParams
  | SecretInjectParams
  | PingParams
  | PolicyCheckParams;

/**
 * Union type for all operation results
 */
export type OperationResult =
  | HttpRequestResult
  | FileReadResult
  | FileWriteResult
  | FileListResult
  | ExecResult
  | OpenUrlResult
  | SecretInjectResult
  | PingResult
  | PolicyCheckResult;

// ========================================
// HTTP Request
// ========================================

export interface HttpRequestParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  followRedirects?: boolean;
}

export interface HttpRequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

// ========================================
// File Operations
// ========================================

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
  entries: FileEntry[];
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: string;
}

// ========================================
// Exec
// ========================================

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

// ========================================
// Open URL
// ========================================

export interface OpenUrlParams {
  url: string;
  browser?: string;
}

export interface OpenUrlResult {
  opened: boolean;
}

// ========================================
// Secret Inject
// ========================================

export interface SecretInjectParams {
  name: string;
  targetEnv?: string;
}

export interface SecretInjectResult {
  value: string;
  injected: boolean;
}

// ========================================
// Ping
// ========================================

export interface PingParams {
  echo?: string;
}

export interface PingResult {
  pong: true;
  echo?: string;
  timestamp: string;
  version: string;
}

// ========================================
// Policy Check
// ========================================

export interface PolicyCheckParams {
  operation: OperationType;
  target: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

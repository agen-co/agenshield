/**
 * Python Patcher Types
 */

export interface PatcherConfig {
  /** Path to Python executable */
  pythonPath: string;

  /** Broker HTTP host */
  brokerHost: string;

  /** Broker HTTP port */
  brokerPort: number;

  /** Whether to use macOS sandbox */
  useSandbox: boolean;

  /** Workspace directory */
  workspacePath: string;

  /** Broker socket path */
  socketPath: string;

  /** Installation target directory */
  installDir?: string;
}

export interface PatcherResult {
  success: boolean;
  message: string;
  paths?: {
    sitecustomize: string;
    wrapper?: string;
    sandboxProfile?: string;
  };
  error?: Error;
}

export interface VerificationResult {
  success: boolean;
  pythonVersion: string;
  sitecustomizeInstalled: boolean;
  networkBlocked: boolean;
  brokerAccessible: boolean;
  details: string[];
}

export interface SitecustomizeConfig {
  brokerHost: string;
  brokerPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enabled: boolean;
}

export interface WrapperConfig {
  pythonPath: string;
  sitecustomizePath: string;
  useSandbox: boolean;
  sandboxProfilePath?: string;
  environmentVariables?: Record<string, string>;
}

export interface SandboxProfileConfig {
  workspacePath: string;
  pythonPath: string;
  brokerHost: string;
  brokerPort: number;
  additionalReadPaths?: string[];
  additionalWritePaths?: string[];
}

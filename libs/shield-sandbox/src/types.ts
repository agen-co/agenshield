/**
 * Types for sandbox user management
 */

export interface SandboxUser {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
  shell: string;
}

export interface SandboxConfig {
  /** Username for the sandbox user */
  username: string;
  /** Home directory path */
  homeDir: string;
  /** Shell to use (should be restricted) */
  shell: string;
  /** Real name for the user */
  realName: string;
}

export interface CreateUserResult {
  success: boolean;
  user?: SandboxUser;
  error?: string;
}

export interface DirectoryStructure {
  /** Local binaries */
  binDir: string;
  /** Wrapper scripts for broker */
  wrappersDir: string;
  /** OpenClaw config */
  configDir: string;
  /** OpenClaw package */
  packageDir: string;
  /** npm global packages */
  npmDir: string;
}

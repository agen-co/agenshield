/**
 * Configuration types for AgenShield
 */

/**
 * User definition for dynamic user creation
 */
export interface UserDefinition {
  /** Username (e.g., 'agenshield_agent' or 'test1_agenshield_agent') */
  username: string;
  /** User ID */
  uid: number;
  /** Primary group ID */
  gid: number;
  /** User shell */
  shell: string;
  /** Home directory */
  home: string;
  /** Real name / description */
  realname: string;
  /** Additional groups */
  groups: string[];
}

/**
 * Group definition for dynamic group creation
 */
export interface GroupDefinition {
  /** Group name (e.g., 'agenshield' or 'test1_agenshield') */
  name: string;
  /** Group ID */
  gid: number;
  /** Description */
  description: string;
}

/**
 * Configuration for user and group creation
 * Supports optional prefix for testing/multiple instances
 */
export interface UserConfig {
  /** Agent user definition */
  agentUser: UserDefinition;
  /** Broker user definition */
  brokerUser: UserDefinition;
  /** Groups to create */
  groups: {
    /** Socket access group (ash_default) */
    socket: GroupDefinition;
    /** Workspace access group (clawworkspace) */
    workspace: GroupDefinition;
  };
  /** Optional prefix for all names (e.g., 'test1' → 'test1_agenshield_agent') */
  prefix: string;
  /** Base name for users/groups (default: 'agenshield') */
  baseName: string;
  /** Base UID for user creation */
  baseUid: number;
  /** Base GID for group creation */
  baseGid: number;
}

/**
 * Paths configuration (can be derived from UserConfig)
 */
export interface PathsConfig {
  /** Socket path */
  socketPath: string;
  /** Main config directory */
  configDir: string;
  /** Policies directory */
  policiesDir: string;
  /** Seatbelt profiles directory */
  seatbeltDir: string;
  /** Log directory */
  logDir: string;
  /** Agent home directory */
  agentHomeDir: string;
  /** Socket directory */
  socketDir: string;
}

/**
 * Full installation configuration
 */
export interface InstallationConfig {
  /** User and group configuration */
  users: UserConfig;
  /** Paths configuration */
  paths: PathsConfig;
  /** Whether to enable HTTP fallback */
  httpFallback: boolean;
  /** HTTP fallback port */
  httpPort: number;
}

export interface ShieldConfig {
  version: string;
  daemon: DaemonConfig;
  broker?: BrokerConfig;
  policies: PolicyConfig[];
  vault?: VaultConfig;
  skills?: SkillsConfig;
  soul?: SoulConfig;
}

export interface DaemonConfig {
  /** HTTP server port (default: 5200) */
  port: number;
  /** HTTP server host (default: 'localhost') */
  host: string;
  /** Logging level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to add agen.shield to /etc/hosts */
  enableHostsEntry: boolean;
}

export interface BrokerConfig {
  /** Unix socket path */
  socketPath: string;
  /** Whether HTTP fallback is enabled */
  httpEnabled: boolean;
  /** HTTP fallback port */
  httpPort: number;
  /** HTTP fallback host */
  httpHost: string;
  /** Path to policies directory */
  policiesPath: string;
  /** Path to audit log */
  auditLogPath: string;
  /** Whether to fail open if policy check fails */
  failOpen: boolean;
  /** Socket file permissions (octal) */
  socketMode?: number;
  /** Socket owner user */
  socketOwner?: string;
  /** Socket owner group */
  socketGroup?: string;
}

export interface PolicyConfig {
  /** Unique identifier for the policy */
  id: string;
  /** Human-readable name */
  name: string;
  /** Policy action: allow, deny, or approval (future) */
  action: 'allow' | 'deny' | 'approval';
  /** What this policy targets */
  target: 'skill' | 'command' | 'url' | 'filesystem';
  /** URL/command patterns to match */
  patterns: string[];
  /** Whether this policy is active */
  enabled: boolean;
  /** Priority (higher = evaluated first) */
  priority?: number;
  /** Operations this policy applies to */
  operations?: string[];
  /** Preset this policy belongs to (undefined = user-created) */
  preset?: string;
  /** Scope restriction: 'agent', 'skill', or 'skill:<slug>' */
  scope?: 'agent' | 'skill' | string;
  /** Network access level for sandboxed commands: none (default), proxy, or direct */
  networkAccess?: 'none' | 'proxy' | 'direct';
}

export interface VaultConfig {
  /** Whether vault is enabled */
  enabled: boolean;
  /** Secret provider type */
  provider: 'local' | 'env';
  /** Path to encrypted vault file */
  vaultPath?: string;
}

export interface SkillsConfig {
  /** Whether skills are enabled */
  enabled: boolean;
  /** Directories to load skills from */
  directories: string[];
  /** Built-in skills to enable */
  builtinSkills?: string[];
}

export interface SoulConfig {
  /** Whether soul injection is enabled */
  enabled: boolean;
  /** Injection mode */
  mode: 'prepend' | 'append' | 'replace';
  /** Custom soul content */
  content?: string;
  /** Security level */
  securityLevel?: 'low' | 'medium' | 'high';
}

// --- Skill Analysis types ---

import type {
  EnvVariableDetail,
  RuntimeRequirement,
  InstallationStep,
  RunCommand,
  SecurityFinding,
  MCPSpecificRisk,
} from './marketplace';

export interface SkillAnalysis {
  status: 'pending' | 'analyzing' | 'complete' | 'error';
  analyzedAt?: string;
  analyzerId: string;
  vulnerability?: {
    level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    details: string[];
    suggestions?: string[];
  };
  commands: ExtractedCommand[];
  error?: string;
  // Rich analysis fields from Vercel analyzer
  envVariables?: EnvVariableDetail[];
  runtimeRequirements?: RuntimeRequirement[];
  installationSteps?: InstallationStep[];
  runCommands?: RunCommand[];
  securityFindings?: SecurityFinding[];
  mcpSpecificRisks?: MCPSpecificRisk[];
}

export interface ExtractedCommand {
  name: string;
  source: 'metadata' | 'analysis';
  field?: string;
  resolvedPath?: string;
  available: boolean;
  required: boolean;
}

export interface AnalyzerConfig {
  id: string;
  name: string;
  type: 'agenshield' | 'custom';
  endpoint?: string;
  enabled: boolean;
  apiKey?: string;
}

export interface SystemBinary {
  name: string;
  path: string;
}

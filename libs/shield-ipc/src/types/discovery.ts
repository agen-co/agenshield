/**
 * Discovery types — shared across packages for binary/skill scanning
 */

export type ExecutionContext = 'root' | 'user' | 'workspace';

export type BinarySourceKind =
  | 'system'         // /usr/bin, /usr/sbin
  | 'homebrew'       // /opt/homebrew/bin or /usr/local/bin (homebrew-managed)
  | 'npm-global'     // npm prefix -g / bin
  | 'yarn-global'    // yarn global bin
  | 'agent-bin'      // $AGENT_HOME/bin (wrappers + shield-exec symlinks)
  | 'workspace-bin'  // workspace/node_modules/.bin
  | 'path-other';    // other PATH directories

export type ProtectionKind = 'proxied' | 'wrapped' | 'allowed' | 'unprotected';

export interface DiscoveredBinary {
  name: string;
  path: string;
  dir: string;
  sourceKind: BinarySourceKind;
  contexts: ExecutionContext[];
  protection: ProtectionKind;
  category: 'system' | 'package-manager' | 'network' | 'shell' | 'language-runtime' | 'other';
  isShieldExecSymlink: boolean;
}

export interface BinaryDirectory {
  path: string;
  sourceKind: BinarySourceKind;
  contexts: ExecutionContext[];
  count: number;
}

export interface SkillMetadata {
  name?: string;
  description?: string;
  version?: string;
  requires?: { bins?: string[]; [key: string]: unknown };
  agenshield?: { allowedCommands?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface DiscoveredSkill {
  name: string;
  path: string;
  hasSkillMd: boolean;
  metadata: SkillMetadata | null;
  requiredCommands: SkillCommandRequirement[];
  approval: 'approved' | 'quarantined' | 'unknown';
}

export interface SkillCommandRequirement {
  name: string;
  source: 'metadata' | 'analysis';
  available: boolean;
  resolvedPath?: string;
  protection?: ProtectionKind;
  required: boolean;
}

export interface DiscoveryOptions {
  agentHome?: string;
  workspaceDir?: string;
  scanSkills?: boolean;
  extraDirs?: string[];
}

export interface DiscoveryResult {
  scannedAt: string;
  binaries: DiscoveredBinary[];
  directories: BinaryDirectory[];
  skills: DiscoveredSkill[];
  summary: DiscoverySummary;
}

export interface DiscoverySummary {
  totalBinaries: number;
  totalDirectories: number;
  totalSkills: number;
  byContext: Record<ExecutionContext, number>;
  byProtection: Record<ProtectionKind, number>;
  bySourceKind: Partial<Record<BinarySourceKind, number>>;
  skillsWithMissingDeps: number;
}

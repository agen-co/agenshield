/**
 * Skill Source Adapter Types
 *
 * Defines the common interface for all skill sources (static, MCP, remote).
 * Used by @agentshield/skills SyncService and daemon adapters.
 */

// ─── Target Platform ──────────────────────────────────────────────────────────

export type TargetPlatform = 'openclaw' | 'claude-code' | 'cursor' | 'generic';

// ─── Skill Files ──────────────────────────────────────────────────────────────

/**
 * A file within a skill source definition.
 * Named SourceSkillFile to avoid collision with IPC's SkillFile (DB-backed).
 */
export interface SourceSkillFile {
  /** Relative path within the skill directory (e.g. 'SKILL.md', 'bin/agenco.mjs') */
  name: string;
  /** Text content */
  content: string;
  /** MIME type (default: 'text/plain') */
  type?: string;
  /** File mode for executables (e.g. 0o755) */
  mode?: number;
}

// ─── Tool Discovery ───────────────────────────────────────────────────────────

export interface DiscoveredTool {
  /** Unique tool identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool description */
  description: string;
  /** Source adapter ID that provided this tool */
  sourceId: string;
  /** Category or integration grouping */
  category?: string;
  /** JSON Schema for tool input */
  inputSchema?: Record<string, unknown>;
}

export interface ToolQuery {
  /** Free-text search */
  search?: string;
  /** Filter by category/integration */
  category?: string;
  /** Maximum results to return */
  limit?: number;
}

// ─── Binary Requirements ──────────────────────────────────────────────────────

export interface BinaryInstallMethod {
  type: 'brew' | 'npm' | 'pip' | 'curl' | 'manual';
  /** Full install command (e.g. 'brew install agenco') */
  command: string;
  /** Package/formula name for the package manager */
  package?: string;
}

export interface RequiredBinary {
  /** Binary name (e.g. 'agenco', 'openclaw') */
  name: string;
  /** Ordered installation methods */
  installMethods: BinaryInstallMethod[];
  /** If true, AgenShield handles installation — OpenClaw install prompts are stripped */
  managedByShield: boolean;
}

// ─── Skill Definition ─────────────────────────────────────────────────────────

export interface SkillDefinition {
  /** Unique skill ID (e.g. 'agenco-slack') */
  skillId: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Semver version string */
  version: string;
  /** SHA-256 hash of all files combined (for update detection) */
  sha: string;
  /** Target platform this definition is formatted for */
  platform: TargetPlatform;
  /** Files composing this skill */
  files: SourceSkillFile[];
  /** Whether this skill is from a trusted source (skip vulnerability analysis) */
  trusted: boolean;
  /** Source adapter ID that produced this definition */
  sourceId: string;
  /** Tags */
  tags?: string[];
  /** Publisher/author */
  author?: string;
  /** Additional platform-specific metadata (e.g. presetPolicies for master skill) */
  metadata?: Record<string, unknown>;
}

// ─── Instructions ─────────────────────────────────────────────────────────────

export interface AdapterInstructions {
  /** Instruction type */
  type: 'soul' | 'identity' | 'system' | 'custom';
  /** Text content to inject */
  content: string;
  /** Injection position relative to existing content */
  mode: 'prepend' | 'append' | 'replace';
  /** Ordering priority (lower = inserted earlier). Default: 100 */
  priority?: number;
}

// ─── Sync Result ──────────────────────────────────────────────────────────────

export interface AdapterSyncResult {
  installed: string[];
  removed: string[];
  updated: string[];
  errors: string[];
}

// ─── Version Tracking ─────────────────────────────────────────────────────────

export interface InstalledSkillVersion {
  skillId: string;
  version: string;
  sha: string;
  sourceId: string;
  installedAt: string;
  trusted: boolean;
}

/**
 * Persistence abstraction for installed skill versions.
 * The daemon provides a concrete implementation backed by JSON on disk.
 */
export interface SkillVersionStore {
  getInstalled(skillId: string): InstalledSkillVersion | null;
  setInstalled(info: InstalledSkillVersion): void;
  removeInstalled(skillId: string): void;
  listInstalled(): InstalledSkillVersion[];
  listBySource(sourceId: string): InstalledSkillVersion[];
}

// ─── Installation Abstraction ─────────────────────────────────────────────────

export interface InstallOptions {
  /** Create shell wrapper in $AGENT_HOME/bin/ */
  createWrapper?: boolean;
  /** Add policy to daemon config */
  addPolicy?: boolean;
  /** Inject installation tag into SKILL.md frontmatter */
  injectTag?: boolean;
  /** Strip env variables from SKILL.md */
  stripEnv?: boolean;
}

export interface UninstallOptions {
  /** Remove shell wrapper */
  removeWrapper?: boolean;
  /** Remove policy from daemon config */
  removePolicy?: boolean;
}

/**
 * Installation abstraction. The daemon provides a concrete implementation
 * that handles broker/sudo file operations, wrappers, and policies.
 */
export interface SkillInstaller {
  install(definition: SkillDefinition, options?: InstallOptions): Promise<void>;
  uninstall(skillId: string, options?: UninstallOptions): Promise<void>;
  isInstalled(skillId: string): boolean;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type SkillsManagerEvent =
  | { type: 'skill:installed'; skillId: string; sourceId: string }
  | { type: 'skill:updated'; skillId: string; sourceId: string }
  | { type: 'skill:removed'; skillId: string; sourceId: string }
  | { type: 'skill:sync-complete'; sourceId: string; result: AdapterSyncResult }
  | { type: 'source:registered'; sourceId: string }
  | { type: 'source:removed'; sourceId: string };

// ─── The Source Adapter Interface ─────────────────────────────────────────────

export interface SkillSourceAdapter {
  /** Unique source identifier (e.g. 'static', 'mcp', 'registry') */
  readonly id: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Whether skills from this source are trusted (skip vulnerability analysis) */
  readonly trusted: boolean;

  /** Discover available tools from this source */
  getTools(query?: ToolQuery): Promise<DiscoveredTool[]>;

  /** Generate skill definitions for a target platform */
  getSkillsFor(target: TargetPlatform): Promise<SkillDefinition[]>;

  /** Return binary installation instructions */
  getBins(): Promise<RequiredBinary[]>;

  /** Get files for a specific skill */
  getSkillFiles(skillId: string): Promise<SkillDefinition | null>;

  /** Return SOUL/IDENTITY/system instructions */
  getInstructions(): Promise<AdapterInstructions[]>;

  /** Check if this source is currently operational */
  isAvailable(): Promise<boolean>;

  /** Optional: Initialize the source (called on registration) */
  initialize?(): Promise<void>;

  /** Optional: Cleanup resources (called on unregistration or shutdown) */
  dispose?(): Promise<void>;
}

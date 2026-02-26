/**
 * Preset System Types
 *
 * A preset defines how to detect, migrate, and run a specific target application.
 * The sandboxing (users, groups, seatbelt, wrappers) is universal for all targets.
 *
 * Also includes pipeline step types (merged from actions/types.ts).
 */

import type { UserDefinition, MigrationScanResult, MigrationSelection, PrivilegeExecResult, PrivilegeExecOptions, ManifestEntry } from '@agenshield/ipc';
import type { HostShellConfigBackup } from './shared/install-helpers.js';

/**
 * Result of detecting a target application
 */
export interface PresetDetectionResult {
  /** Whether the target was found */
  found: boolean;
  /** Installed version (if detected) */
  version?: string;
  /** Path to the main package/source directory */
  packagePath?: string;
  /** Path to the binary/entry point */
  binaryPath?: string;
  /** Path to the config directory */
  configPath?: string;
  /** How the target was installed */
  method?: 'npm' | 'git' | 'binary' | 'custom';
}

/**
 * Directory structure for migration
 */
export interface MigrationDirectories {
  /** Local binaries directory */
  binDir: string;
  /** Wrapper scripts directory */
  wrappersDir: string;
  /** Config directory */
  configDir: string;
  /** Package/source directory (legacy, no longer created by default) */
  packageDir?: string;
  /** npm packages directory */
  npmDir: string;
}

/**
 * Context provided to preset migration
 */
export interface MigrationContext {
  /** Agent user definition */
  agentUser: UserDefinition;
  /** Directory structure for the sandbox */
  directories: MigrationDirectories;
  /** Entry point path (for custom preset) */
  entryPoint?: string;
  /** Detection result from the detect phase */
  detection?: PresetDetectionResult;
  /** User's selection of items to migrate (from scan step) */
  selection?: MigrationSelection;
}

/**
 * Result of migrating a target to the sandbox
 */
export interface PresetMigrationResult {
  /** Whether migration succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** New paths after migration */
  newPaths?: {
    packagePath: string;
    binaryPath: string;
    configPath?: string;
  };
}

/**
 * Context provided to preset install() method
 */
export interface InstallContext {
  /** Agent user home directory */
  agentHome: string;
  /** Agent username (e.g., ash_openclaw_agent) */
  agentUsername: string;
  /** Socket group name */
  socketGroupName: string;
  /** Detection result from detect phase */
  detection?: PresetDetectionResult;
  /** Host user who originally ran the target */
  hostUsername: string;
  /** Host user's home directory (e.g., /Users/david) */
  hostHome: string;
  /** Requested version to install (e.g., '2026.2.6' or 'latest') */
  requestedVersion?: string;
  /** Run a command as root via privilege executor */
  execAsRoot: (cmd: string, opts?: PrivilegeExecOptions) => Promise<PrivilegeExecResult>;
  /** Run a command as the agent user via privilege executor */
  execAsUser: (cmd: string, opts?: PrivilegeExecOptions) => Promise<PrivilegeExecResult>;
  /** Run as the agent user with plain /bin/bash (bypasses guarded shell — for install-time downloads) */
  execAsUserDirect: (cmd: string, opts?: PrivilegeExecOptions) => Promise<PrivilegeExecResult>;
  /** Progress callback */
  onProgress: (step: string, progress: number, message: string) => void;
  /** Log callback */
  onLog: (message: string) => void;
  /** Per-step log callback — sends log messages scoped to a specific pipeline step */
  onStepLog?: (stepId: string, message: string) => void;
  /** Profile base name (e.g., 'openclaw', 'oc1', 'claudecode') for naming system resources */
  profileBaseName: string;
  /** When true, skip host config copy and allow onboarding (fresh OpenClaw install) */
  freshInstall?: boolean;
  /** Which Claude config categories to copy from host (defaults to DEFAULT_CLAUDE_CONFIG_CATEGORIES) */
  configCopyCategories?: ClaudeConfigCategory[];
}

/**
 * Result of installing the target app's runtime environment
 */
export interface InstallResult {
  success: boolean;
  failedStep?: string;
  error?: string;
  appBinaryPath?: string;
  version?: string;
  /** Path to a gateway plist written but NOT loaded (deferred start). */
  gatewayPlistPath?: string;
  /** Manifest entries from the pipeline runner (preset-layer steps) */
  manifestEntries?: ManifestEntry[];
}

/**
 * A preset defines how to detect, migrate, and run a specific target application.
 * The sandboxing (users, groups, seatbelt, wrappers) is universal.
 */
export interface TargetPreset {
  /** Unique preset identifier */
  id: string;

  /** Display name */
  name: string;

  /** Description shown in wizard */
  description: string;

  /**
   * Commands this preset requires in the sandbox.
   * These will be installed as protected wrappers in $HOME/bin.
   * Names must match keys in WRAPPER_DEFINITIONS (e.g. 'node', 'npm', 'git', 'curl').
   */
  requiredBins: string[];

  /**
   * Optional commands the preset can use if available.
   * Installed only when the user opts in or when the full wrapper set is requested.
   */
  optionalBins?: string[];

  /**
   * Detect if this target is installed on the system.
   * Returns detection info or null if not found.
   */
  detect(): Promise<PresetDetectionResult | null>;

  /**
   * Scan the source application for migratable items (skills, env vars).
   * Called AFTER the AgenShield environment is initialized but BEFORE migration.
   * Returns discovered items for user selection.
   * Optional — presets that don't support scanning return null.
   */
  scan?(detection: PresetDetectionResult): Promise<MigrationScanResult | null>;

  /**
   * Migrate the target to the sandbox user.
   * Copies files, sets permissions, creates entry wrapper.
   * When context.selection is provided, only selected items are migrated.
   */
  migrate(context: MigrationContext): Promise<PresetMigrationResult>;

  /**
   * Get the command to run the target in the sandbox.
   * This is what the wrapper scripts will invoke.
   */
  getEntryCommand(context: MigrationContext): string;

  /** Policy preset IDs to seed when this target is shielded */
  policyPresetIds?: string[];

  /**
   * Shell feature flags for the guarded shell environment.
   * Controls which toolchains are included in .zshenv / .zshrc.
   */
  shellFeatures?: { homebrew?: boolean; nvm?: boolean };

  /**
   * Paths relative to agentHome to deny writes to in the seatbelt profile.
   * e.g. ['.openclaw'] or ['.claude']. The sandbox always denies writes to
   * bin, .zdot, and .agenshield regardless of this setting.
   */
  seatbeltDenyPaths?: string[];

  /**
   * Install the target app's full runtime environment in the agent user.
   * Called after sandbox infrastructure is created (users, dirs, wrappers).
   * Optional — presets that don't define install() skip this step.
   */
  install?(context: InstallContext): Promise<InstallResult>;
}

// ── Claude Config Copy Categories ───────────────────────────────

/** Categories of host Claude config that can be selectively copied */
export type ClaudeConfigCategory = 'settings' | 'plugins' | 'memory' | 'statsig' | 'plans';

/** Default categories copied when no explicit selection is provided */
export const DEFAULT_CLAUDE_CONFIG_CATEGORIES: ClaudeConfigCategory[] = ['settings', 'plugins', 'memory', 'statsig'];

// ── Pipeline Step Types (merged from actions/types.ts) ──────────

/** Which OS user runs the step's commands */
export type StepUser = 'root' | 'agent' | 'mixed';

/** Result of checking whether a step needs to run */
export type CheckResult = 'needed' | 'satisfied' | 'error';

/** Result of executing a step */
export interface StepResult {
  /** Whether the step actually changed anything (Ansible-style) */
  changed: boolean;
  /** Key-value outputs for downstream steps (e.g., { nodePath: '/path/to/node' }) */
  outputs?: Record<string, string>;
  /** Warning messages (non-fatal) */
  warnings?: string[];
}

/** Accumulated pipeline state — shared mutable bag across steps */
export interface PipelineState {
  /** Merged outputs from completed steps, keyed by `stepId.outputKey` */
  outputs: Record<string, string>;
  /** Shell config backups for save/restore pattern */
  shellBackups?: HostShellConfigBackup[];
}

/** A single install step — the atomic unit of the pipeline */
export interface InstallStep {
  /** Unique ID — matches ShieldStepDefinition.id for SSE (e.g., 'install_homebrew') */
  id: string;
  /** Short display name (e.g., 'Install Homebrew') */
  name: string;
  /** Longer description for logs and expandable UI rows */
  description: string;
  /** Phase number (maps to SHIELD_PHASE_LABELS for UI grouping) */
  phase: number;
  /** Message shown in shield-ui progress area while this step runs */
  progressMessage: string;
  /** Which user(s) the step runs commands as */
  runsAs: StepUser;
  /** Default timeout in ms */
  timeout: number;
  /** Relative weight for progress calculation (runner normalizes to %) */
  weight: number;
  /** Semver range — step skipped if target version doesn't satisfy */
  versionRange?: string;

  /**
   * Idempotency check — is this step already satisfied?
   * Called before run(). Return 'satisfied' to skip, 'needed' to execute.
   * Optional — when omitted, step always runs.
   */
  check?: (ctx: InstallContext, state: PipelineState) => Promise<CheckResult>;

  /**
   * Skip predicate — return true to skip entirely.
   * Different from check(): skip() is for pipeline logic (e.g., freshInstall),
   * check() is for idempotency (e.g., "brew already installed").
   */
  skip?: (ctx: InstallContext, state: PipelineState) => boolean;

  /**
   * Dynamic step injection — examine context/state and request
   * additional steps to be inserted into the pipeline.
   * Called after check(), before run(). Injected steps run AFTER this step.
   */
  resolve?: (ctx: InstallContext, state: PipelineState) => InstallStep[] | null;

  /** Execute the step. Throw to fail. Return StepResult on success. */
  run: (ctx: InstallContext, state: PipelineState) => Promise<StepResult>;

  /** Optional compensating action — called if a LATER step fails (saga pattern). */
  rollback?: (ctx: InstallContext, state: PipelineState) => Promise<void>;
}

/** Pipeline result — extends InstallResult with manifest data */
export interface PipelineResult extends InstallResult {
  /** Manifest entries for all steps that ran in this pipeline */
  manifestEntries: ManifestEntry[];
}

/** Options for the pipeline runner */
export interface PipelineOptions {
  /** Target version for semver filtering */
  version?: string;
  /** Called before each step starts */
  onStepStart?: (step: InstallStep, index: number, total: number) => void;
  /** Called after each step completes */
  onStepComplete?: (step: InstallStep, result: StepResult, index: number) => void;
  /** Enable rollback on failure (saga pattern) */
  rollbackOnFailure?: boolean;
}

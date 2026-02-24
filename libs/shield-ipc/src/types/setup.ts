/**
 * Setup types — detection and shielding flow
 */

/**
 * A detected target on the system that can be shielded
 */
export interface DetectedTarget {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Target type (e.g. 'claude', 'cursor', 'windsurf') */
  type: string;
  /** Version if detectable */
  version?: string;
  /** Path to the target binary */
  binaryPath?: string;
  /** Detection method used */
  method: string;
  /** Whether the target is already shielded */
  shielded: boolean;
  /** Whether the app process is currently running */
  isRunning?: boolean;
  /** Whether the app is running as privileged root user */
  runAsRoot?: boolean;
}

/**
 * An old AgenShield installation found on the system
 */
export interface OldInstallation {
  /** Version of the old installation */
  version: string;
  /** When it was installed */
  installedAt?: string;
  /** Components from the old installation */
  components: {
    /** macOS users created (ash_*) */
    users: string[];
    /** macOS groups created */
    groups: string[];
    /** Directories (e.g. /opt/agenshield) */
    directories: string[];
    /** LaunchDaemon plists (com.agenshield.*) */
    launchDaemons: string[];
  };
}

/**
 * Detection scan results
 */
export interface DetectionResult {
  /** Detected targets on the system */
  targets: DetectedTarget[];
  /** Old AgenShield installations found */
  oldInstallations: OldInstallation[];
}

/**
 * Progress update for shielding a target
 */
export interface ShieldProgress {
  /** Target being shielded */
  targetId: string;
  /** Current step name */
  step: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable message */
  message?: string;
}

// ── Granular step visibility ──────────────────────────────────

/** Definition of a shield step (static metadata). */
export interface ShieldStepDefinition {
  /** Unique step ID */
  id: string;
  /** Phase number (0-14) corresponding to manual doc */
  phase: number;
  /** Short display name */
  name: string;
  /** Longer description shown on expand */
  description: string;
}

/** Runtime status of a single step. */
export type ShieldStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Runtime state of a single step (sent over SSE). */
export interface ShieldStepState {
  id: string;
  name: string;
  description: string;
  status: ShieldStepStatus;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
}

/** Human-readable phase labels for grouping steps in the UI. */
export const SHIELD_PHASE_LABELS: Record<number, string> = {
  0: 'Cleanup',
  1: 'Detection',
  2: 'Users & Groups',
  3: 'Directories & Shell',
  4: 'Command Wrappers',
  5: 'PATH Router',
  6: 'Homebrew',
  7: 'NVM & Node.js',
  8: 'Target App',
  9: 'Configuration',
  10: 'Security Profile',
  11: 'Broker Daemon',
  12: 'Gateway',
  13: 'Profile & Policies',
  14: 'Finalize',
};

/**
 * Granular step definitions for the OpenClaw shield process.
 * Maps phases 0-14 from the manual doc.
 */
// ── Install Manifest ─────────────────────────────────────────

/** A single entry in the install manifest — records what one step did. */
export interface ManifestEntry {
  /** Step ID (e.g. 'install_homebrew', 'create_agent_user') */
  stepId: string;
  /** Phase number matching SHIELD_PHASE_LABELS */
  phase: number;
  /** Whether the step actually changed anything (false = idempotent skip) */
  changed: boolean;
  /** Outcome of the step */
  status: 'completed' | 'skipped' | 'failed';
  /** Key-value outputs needed for rollback (paths, labels, usernames) */
  outputs: Record<string, string>;
  /** ISO timestamp when the step finished */
  completedAt: string;
  /** Whether the step is infrastructure or preset-specific */
  layer: 'infra' | 'preset';
}

/** Persisted manifest of everything the shield pipeline did. Used for rollback. */
export interface InstallManifest {
  version: '1.0';
  presetId: string;
  createdAt: string;
  entries: ManifestEntry[];
}

// ── Step definitions ─────────────────────────────────────────

export const OPENCLAW_SHIELD_STEPS: ShieldStepDefinition[] = [
  // Phase 0: Cleanup
  { id: 'cleanup_stale_check', phase: 0, name: 'Check stale installations', description: 'Detect and remove orphaned ash_default_* users and artifacts' },
  // Phase 1: Detection
  { id: 'resolve_preset', phase: 1, name: 'Resolve target preset', description: 'Identify the preset and run target detection' },
  // Phase 2: Users & Groups
  { id: 'create_socket_group', phase: 2, name: 'Create socket group', description: 'Create the ash_ socket group for IPC' },
  { id: 'create_agent_user', phase: 2, name: 'Create agent user', description: 'Create the sandboxed agent user account' },
  { id: 'create_broker_user', phase: 2, name: 'Create broker user', description: 'Create the broker user account' },
  // Phase 3: Directories & Shell
  { id: 'create_directories', phase: 3, name: 'Create directories', description: 'Create agent home, bin, config, socket, and log directories' },
  { id: 'create_marker', phase: 3, name: 'Create .agenshield marker', description: 'Write root-owned meta.json for user identification' },
  { id: 'install_guarded_shell', phase: 3, name: 'Install guarded shell', description: 'Write guarded-shell launcher to /usr/local/bin' },
  { id: 'install_zdotdir', phase: 3, name: 'Install ZDOTDIR', description: 'Write .zshenv and .zshrc to agent ZDOTDIR' },
  { id: 'verify_shell', phase: 3, name: 'Verify shell', description: 'Confirm guarded-shell is executable and registered in /etc/shells' },
  // Phase 4: Command Wrappers
  { id: 'deploy_interceptor', phase: 4, name: 'Deploy interceptor', description: 'Copy interceptor binary to shared lib directory' },
  { id: 'deploy_broker_binary', phase: 4, name: 'Deploy broker binary', description: 'Copy agenshield-broker to shared bin directory' },
  { id: 'deploy_shield_client', phase: 4, name: 'Deploy shield-client', description: 'Installing shield-client for wrapper scripts' },
  { id: 'install_wrapper_scripts', phase: 4, name: 'Install wrapper scripts', description: 'Generate and install command wrapper scripts' },
  { id: 'install_seatbelt', phase: 4, name: 'Install seatbelt profiles', description: 'Generate and install macOS sandbox seatbelt profiles' },
  { id: 'install_basic_commands', phase: 4, name: 'Install basic commands', description: 'Create symlinks for basic system commands (ls, cat, grep, etc.)' },
  { id: 'lockdown_permissions', phase: 4, name: 'Lock down permissions', description: 'Set root ownership and restrict permissions on wrappers' },
  // Phase 5: PATH Router
  { id: 'install_path_registry', phase: 5, name: 'Install PATH registry', description: 'Register instance in /etc/agenshield/path-registry.json' },
  { id: 'install_path_router', phase: 5, name: 'Install PATH router', description: 'Write router wrapper to /usr/local/bin' },
  // Phase 6: Homebrew
  { id: 'install_homebrew', phase: 6, name: 'Install Homebrew', description: 'Download and install Homebrew in agent home' },
  // Phase 7: NVM & Node.js
  { id: 'install_nvm', phase: 7, name: 'Install NVM', description: 'Install Node Version Manager in agent home' },
  { id: 'install_node', phase: 7, name: 'Install Node.js', description: 'Install Node.js v24 via NVM' },
  { id: 'copy_node_binary', phase: 7, name: 'Copy node binary', description: 'Copy node binary for interceptor and broker use' },
  // Phase 8: Target App
  { id: 'install_openclaw', phase: 8, name: 'Install OpenClaw', description: 'Install OpenClaw via official installer' },
  { id: 'onboard_openclaw', phase: 8, name: 'Onboard OpenClaw', description: 'Run non-interactive onboarding to create openclaw.json' },
  { id: 'stop_host', phase: 8, name: 'Stop host processes', description: 'Stop host OpenClaw daemon and gateway processes' },
  // Phase 9: Configuration
  { id: 'copy_config', phase: 9, name: 'Copy host config', description: 'Copy and rewrite host OpenClaw configuration' },
  { id: 'verify_openclaw', phase: 9, name: 'Verify OpenClaw', description: 'Run openclaw --version to verify installation' },
  { id: 'patch_node', phase: 9, name: 'Patch NVM node', description: 'Wrap NVM node binary with interceptor' },
  // Phase 10: Security Profile
  { id: 'generate_seatbelt', phase: 10, name: 'Generate seatbelt', description: 'Generate and install macOS sandbox profile' },
  // Phase 11: Broker Daemon
  { id: 'install_sudoers', phase: 11, name: 'Install sudoers', description: 'Configure passwordless sudo rules for host user' },
  { id: 'install_broker_daemon', phase: 11, name: 'Install broker daemon', description: 'Write and load broker LaunchDaemon plist' },
  { id: 'wait_broker_socket', phase: 11, name: 'Wait for broker', description: 'Wait for broker socket to become available' },
  // Phase 12: Gateway
  { id: 'gateway_preflight', phase: 12, name: 'Gateway pre-flight', description: 'Verify all gateway dependencies' },
  { id: 'write_gateway_plist', phase: 12, name: 'Write gateway plist', description: 'Write gateway launcher and LaunchDaemon plist' },
  { id: 'start_gateway', phase: 12, name: 'Start gateway', description: 'Load and start the OpenClaw gateway' },
  // Phase 13: Profile & Policies
  { id: 'create_profile', phase: 13, name: 'Save profile', description: 'Create profile in storage database' },
  { id: 'seed_policies', phase: 13, name: 'Seed policies', description: 'Apply preset security policies' },
  // Phase 14: Finalize
  { id: 'finalize', phase: 14, name: 'Finalize', description: 'Complete shielding and emit completion event' },
];

/**
 * Types for the setup wizard
 */

import type { OriginalInstallation, UserConfig, PathsConfig, MigrationScanResult, MigrationSelection } from '@agenshield/ipc';
import type { TargetPreset, PresetDetectionResult } from '@agenshield/sandbox';

export type WizardStepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

/**
 * Wizard step IDs
 */
export type WizardStepId =
  | 'prerequisites'
  | 'detect'
  | 'install-target'
  | 'configure'
  | 'confirm'
  | 'create-groups'
  | 'create-agent-user'
  | 'create-broker-user'
  | 'create-directories'
  | 'setup-socket'
  | 'install-homebrew'
  | 'install-nvm'
  | 'configure-shell'
  | 'install-wrappers'
  | 'generate-seatbelt'
  | 'install-broker'
  | 'install-daemon-config'
  | 'install-policies'
  | 'setup-launchdaemon'
  | 'install-openclaw'
  | 'copy-openclaw-config'
  | 'stop-host-openclaw'
  | 'onboard-openclaw'
  | 'verify'
  | 'start-openclaw'
  | 'setup-passcode'
  | 'open-dashboard'
  | 'complete';

export interface WizardStep {
  id: WizardStepId;
  name: string;
  description: string;
  status: WizardStepStatus;
  error?: string;
}

export interface WizardState {
  currentStep: number;
  steps: WizardStep[];
  isComplete: boolean;
  hasError: boolean;
}

/**
 * User information after creation
 */
export interface SandboxUserInfo {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
  shell: string;
}

/**
 * Wizard options passed from CLI
 */
export interface WizardOptions {
  /** Target preset to use: 'openclaw', 'custom', or auto-detect if not specified */
  targetPreset?: string;
  /** Entry point for custom target (Node.js file path) */
  entryPoint?: string;
  /** Base name for users/groups (default: 'agenshield') */
  baseName?: string;
  /** Optional prefix for user/group names (for testing) */
  prefix?: string;
  /** Optional base UID (for testing) */
  baseUid?: number;
  /** Optional base GID (for testing) */
  baseGid?: number;
  /** Dry run mode - show what would be done without making changes */
  dryRun?: boolean;
  /** Skip confirmation prompt */
  skipConfirm?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Node.js version to install via NVM (default: '24') */
  nodeVersion?: string;
}

export interface WizardContext {
  /** Wizard options from CLI */
  options?: WizardOptions;

  /** User configuration (dynamic based on prefix/baseUid/baseName) */
  userConfig?: UserConfig;

  /** Paths configuration */
  pathsConfig?: PathsConfig;

  /** Selected target preset */
  preset?: TargetPreset;

  /** Detection result from the preset */
  presetDetection?: PresetDetectionResult;

  /** Original installation info for backup (set during backup step) */
  originalInstallation?: OriginalInstallation;

  /** Agent user info */
  agentUser?: SandboxUserInfo;

  /** Broker user info */
  brokerUser?: SandboxUserInfo;

  /** Groups created */
  groupsCreated?: {
    socket: { name: string; gid: number };
    workspace: { name: string; gid: number };
  };

  /** Directory structure created */
  directories?: {
    binDir: string;
    wrappersDir: string;
    configDir: string;
    packageDir: string;
    npmDir: string;
    socketDir: string;
    logDir: string;
    seatbeltDir: string;
  };

  /** Socket setup result */
  socketSetup?: {
    path: string;
    success: boolean;
  };

  /** Seatbelt profiles generated */
  seatbeltProfiles?: {
    agentProfile: string;
    operationProfiles: string[];
  };

  /** Wrappers installed */
  wrappersInstalled?: string[];

  /** Broker installation */
  brokerInstalled?: {
    binaryPath: string;
    success: boolean;
  };

  /** Daemon configuration */
  daemonConfig?: {
    configPath: string;
    success: boolean;
  };

  /** Policies installed */
  policiesInstalled?: {
    builtinCount: number;
    customCount: number;
  };

  /** LaunchDaemon setup */
  launchDaemon?: {
    plistPath: string;
    loaded: boolean;
  };

  /** Migration result */
  migration?: {
    success: boolean;
    newPaths?: {
      packagePath: string;
      binaryPath: string;
      configPath?: string;
    };
  };

  /** Verification result */
  verification?: {
    usersValid: boolean;
    groupsValid: boolean;
    directoriesValid: boolean;
    socketValid: boolean;
    daemonRunning: boolean;
    networkBlocked: boolean;
  };

  /** Passcode setup result */
  passcodeSetup?: {
    /** Whether passcode was set */
    configured: boolean;
    /** Whether user skipped passcode setup */
    skipped: boolean;
  };

  /** Passcode value (temporary, only during wizard flow) */
  passcodeValue?: string;

  /** Whether the target can be installed (e.g. via npm) */
  targetInstallable?: boolean;

  /** Whether the user requested target installation */
  installTargetRequested?: boolean;

  /** Migration scan result (from scan-source step) */
  scanResult?: MigrationScanResult;

  /** User's migration selection (from select-items step) */
  migrationSelection?: MigrationSelection;

  // ── New setup flow fields ──────────────────────────────────────────────

  /** Homebrew installation result */
  homebrewInstalled?: {
    brewPath: string;
    success: boolean;
  };

  /** NVM installation result */
  nvmInstalled?: {
    nvmDir: string;
    nodeVersion: string;
    nodeBinaryPath: string;
    success: boolean;
  };

  /** Shell configuration result */
  shellConfigured?: {
    success: boolean;
  };

  /** OpenClaw installation result (via npm in agent sandbox) */
  openclawInstalled?: {
    version: string;
    binaryPath: string;
    success: boolean;
  };

  /** OpenClaw config copy result */
  openclawConfigCopied?: {
    configDir: string;
    sanitized: boolean;
    success: boolean;
  };

  /** Host OpenClaw stop result */
  hostOpenclawStopped?: {
    daemonStopped: boolean;
    gatewayStopped: boolean;
  };

  /** OpenClaw LaunchDaemon setup */
  openclawLaunchDaemons?: {
    daemonPlistPath: string;
    gatewayPlistPath: string;
    loaded: boolean;
  };

  /** OpenClaw onboard result */
  openclawOnboarded?: {
    success: boolean;
  };

  /** OpenClaw gateway process (started inline) */
  openclawGateway?: {
    pid: number;
    running: boolean;
  };
}

/**
 * Step definition for wizard
 */
export interface WizardStepDefinition {
  id: WizardStepId;
  name: string;
  description: string;
  /** Whether this step requires sudo */
  requiresSudo?: boolean;
  /** Dependencies (other step IDs that must complete first) */
  dependsOn?: WizardStepId[];
  /** Phase: 'detection' (runs before confirm) or 'setup' (runs after confirm) */
  phase: 'detection' | 'setup';
}

/**
 * All wizard step definitions
 */
export const WIZARD_STEPS: WizardStepDefinition[] = [
  // Detection phase
  {
    id: 'prerequisites',
    name: 'Check Prerequisites',
    description: 'Verify Node.js 22+, macOS, and required tools',
    phase: 'detection',
  },
  {
    id: 'detect',
    name: 'Detect Target',
    description: 'Find target application (auto-detect or use specified preset)',
    phase: 'detection',
    dependsOn: ['prerequisites'],
  },
  {
    id: 'install-target',
    name: 'Install Target',
    description: 'Install target application if not found',
    phase: 'detection',
    dependsOn: ['detect'],
  },
  {
    id: 'configure',
    name: 'Configure',
    description: 'Set up user configuration',
    phase: 'detection',
    dependsOn: ['install-target'],
  },
  {
    id: 'confirm',
    name: 'Confirm Setup',
    description: 'Show plan and get user confirmation',
    phase: 'detection',
    dependsOn: ['configure'],
  },

  // Setup phase
  {
    id: 'create-groups',
    name: 'Create Groups',
    description: 'Create socket access and workspace groups',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['confirm'],
  },
  {
    id: 'create-agent-user',
    name: 'Create Agent User',
    description: 'Create sandboxed agent user with guarded shell',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-groups'],
  },
  {
    id: 'create-broker-user',
    name: 'Create Broker User',
    description: 'Create broker user for daemon',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-groups'],
  },
  {
    id: 'create-directories',
    name: 'Create Directories',
    description: 'Create /opt/agenshield, /etc/agenshield, etc.',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-agent-user', 'create-broker-user'],
  },
  {
    id: 'setup-socket',
    name: 'Setup Socket',
    description: 'Create /var/run/agenshield/ with correct permissions',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-homebrew',
    name: 'Install Homebrew',
    description: 'Install user-specific Homebrew for agent user',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-nvm',
    name: 'Install NVM & Node.js',
    description: 'Install NVM and Node.js for agent user (this may take up to a minute)',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-homebrew'],
  },
  {
    id: 'configure-shell',
    name: 'Configure Shell',
    description: 'Set up guarded shell with Homebrew and NVM paths',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-nvm'],
  },
  {
    id: 'install-wrappers',
    name: 'Install Wrappers',
    description: 'Install command wrappers to agent home bin directory (this may take up to a minute)',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['configure-shell'],
  },
  {
    id: 'generate-seatbelt',
    name: 'Generate Seatbelt Profiles',
    description: 'Generate macOS sandbox profiles',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-broker',
    name: 'Install Broker',
    description: 'Install broker binary',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-daemon-config',
    name: 'Install Daemon Config',
    description: 'Write daemon configuration files',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-policies',
    name: 'Install Policies',
    description: 'Write default security policies',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'setup-launchdaemon',
    name: 'Setup LaunchDaemon',
    description: 'Create and load broker launchd plist (this may take up to a minute)',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-broker', 'install-daemon-config'],
  },
  {
    id: 'install-openclaw',
    name: 'Install OpenClaw',
    description: 'Install OpenClaw in agent sandbox via NVM npm',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['setup-launchdaemon', 'install-wrappers'],
  },
  {
    id: 'copy-openclaw-config',
    name: 'Copy OpenClaw Config',
    description: 'Copy and sanitize OpenClaw config from host user',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-openclaw'],
  },
  {
    id: 'stop-host-openclaw',
    name: 'Stop Host OpenClaw',
    description: 'Stop OpenClaw daemon and gateway on host user',
    phase: 'setup',
    dependsOn: ['copy-openclaw-config'],
  },
  {
    id: 'onboard-openclaw',
    name: 'Initialize OpenClaw',
    description: 'Run openclaw onboard to initialize agent environment',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['stop-host-openclaw'],
  },
  {
    id: 'verify',
    name: 'Verify Installation',
    description: 'Verify users, groups, and directories',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['onboard-openclaw'],
  },
  {
    id: 'start-openclaw',
    name: 'Start OpenClaw',
    description: 'Install and start OpenClaw LaunchDaemons with intercepted Node.js',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['verify'],
  },
  {
    id: 'setup-passcode',
    name: 'Setup Passcode',
    description: 'Set a passcode to protect sensitive configuration',
    phase: 'setup',
    dependsOn: ['start-openclaw'],
  },
  {
    id: 'open-dashboard',
    name: 'Open Dashboard',
    description: 'Open AgenShield dashboard in browser',
    phase: 'setup',
    dependsOn: ['setup-passcode'],
  },
  {
    id: 'complete',
    name: 'Complete',
    description: 'Setup finished successfully',
    phase: 'setup',
    dependsOn: ['open-dashboard'],
  },
];

/**
 * Get step IDs for a specific phase
 */
export function getStepsByPhase(phase: 'detection' | 'setup'): WizardStepId[] {
  return WIZARD_STEPS.filter((s) => s.phase === phase).map((s) => s.id);
}

/**
 * Get all step IDs in order
 */
export function getAllStepIds(): WizardStepId[] {
  return WIZARD_STEPS.map((s) => s.id);
}

/**
 * Create initial wizard steps from definitions
 */
export function createWizardSteps(): WizardStep[] {
  return WIZARD_STEPS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    status: 'pending' as const,
  }));
}

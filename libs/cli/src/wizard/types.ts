/**
 * Types for the setup wizard
 */

import type { OriginalInstallation, UserConfig, PathsConfig } from '@agenshield/ipc';
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
  | 'backup'
  | 'create-groups'
  | 'create-agent-user'
  | 'create-broker-user'
  | 'create-directories'
  | 'setup-socket'
  | 'generate-seatbelt'
  | 'install-wrappers'
  | 'install-broker'
  | 'install-daemon-config'
  | 'install-policies'
  | 'setup-launchdaemon'
  | 'migrate'
  | 'verify'
  | 'setup-passcode'
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
    id: 'backup',
    name: 'Backup Installation',
    description: 'Save backup for safe reversal',
    phase: 'setup',
    dependsOn: ['confirm'],
  },
  {
    id: 'create-groups',
    name: 'Create Groups',
    description: 'Create socket access and workspace groups',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['backup'],
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
    id: 'generate-seatbelt',
    name: 'Generate Seatbelt Profiles',
    description: 'Generate macOS sandbox profiles',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['create-directories'],
  },
  {
    id: 'install-wrappers',
    name: 'Install Wrappers',
    description: 'Install command wrappers to agent home bin directory',
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
    description: 'Create and load launchd plist',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-broker', 'install-daemon-config'],
  },
  {
    id: 'migrate',
    name: 'Migrate Installation',
    description: 'Move target application to sandbox',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['install-wrappers', 'setup-launchdaemon'],
  },
  {
    id: 'verify',
    name: 'Verify Installation',
    description: 'Test sandboxed application',
    phase: 'setup',
    requiresSudo: true,
    dependsOn: ['migrate'],
  },
  {
    id: 'setup-passcode',
    name: 'Setup Passcode',
    description: 'Set a passcode to protect sensitive configuration',
    phase: 'setup',
    dependsOn: ['verify'],
  },
  {
    id: 'complete',
    name: 'Complete',
    description: 'Setup finished successfully',
    phase: 'setup',
    dependsOn: ['setup-passcode'],
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

/**
 * AgenShield Sandbox Library
 *
 * User isolation and sandboxing utilities for OpenClaw.
 * Handles creation of restricted users, guarded shells,
 * and directory structures for sandboxed execution.
 *
 * @packageDocumentation
 */

// Errors
export {
  SandboxError,
  InstallError,
  HomebrewInstallError,
  NvmInstallError,
  TargetAppInstallError,
  GuardedShellInstallError,
  StepExecutionError,
  GatewayPreflightError,
} from './errors.js';

// Types (primary type definitions)
export type { SandboxUser, SandboxConfig, CreateUserResult, DirectoryStructure as SandboxDirectoryStructure } from './types.js';

// Exec (consolidated sudo helper)
export { sudoExec, type SudoResult } from './exec/index.js';

// Guarded shell
export {
  guardedShellPath,
  zdotDir,
  zdotZshenvContent,
  zdotZshrcContent,
  GUARDED_SHELL_CONTENT,
  ZDOT_ZSHRC_CONTENT,
  type ShellFeatures,
} from './shell/guarded-shell.js';

// Shell (shield-exec)
export {
  shieldExecPath,
  generateShieldExecContent,
  PROXIED_COMMANDS,
} from './shell/shield-exec.js';

// Users management (modern async + legacy sync)
export {
  createUserConfig,
  createGroups,
  createGroup,
  createUser,
  createAgentUser,
  createBrokerUser,
  createUsers,
  createAllUsersAndGroups,
  deleteGroup,
  deleteUser,
  deleteGroups,
  deleteUsers,
  deleteAllUsersAndGroups,
  groupExists,
  userExists,
  getUserInfo,
  getGroupInfo,
  verifyUsersAndGroups,
  DEFAULT_BASE_UID,
  DEFAULT_BASE_GID,
  DEFAULT_BASE_NAME,
  ASH_PREFIX,
  isAgenshieldUser,
  listAgenshieldUsers,
  discoverOrphanedEntities,
  type CreateResult,
  type AgenshieldUserMeta,
  type OrphanedEntity,
} from './users/index.js';

// Directories management
export {
  createDirectoryStructure,
  createPathsConfig,
  createDirectory,
  createSystemDirectories,
  createAgentDirectories,
  createAllDirectories,
  verifyDirectories,
  seedConfigFiles,
  setupSocketDirectory,
  getDirectoryInfo,
  removeAllDirectories,
  type DirectoryDefinition,
  type DirectoryStructure,
  type DirectoryResult,
} from './directories/index.js';

// Migration
export * from './backup/migration.js';

// Host Scanner (read-only scanning of source application)
export {
  scanHost,
  scanOpenClawConfig,
  scanProcessEnv,
  scanShellProfiles,
  maskSecretValue,
  resolveEnvVarValue,
  type ScanHostOptions,
} from './detection/host-scanner.js';

// Security
export * from './detection/security.js';

// Detection
export * from './detection/detect.js';

// Backup & Restore
export * from './backup/backup.js';
export * from './backup/restore.js';

// Wrappers
export {
  WRAPPERS,
  WRAPPER_DEFINITIONS,
  installWrapper,
  installWrappers,
  installSpecificWrappers,
  installWrapperWithSudo,
  uninstallWrapper,
  uninstallWrappers,
  verifyWrappers,
  installGuardedShell,
  installAllWrappers,
  installShieldExec,
  deployInterceptor,
  copyNodeBinary,
  copyBrokerBinary,
  copyShieldClient,
  installAgentNvm,
  patchNvmNode,
  execWithProgress,
  type NvmInstallResult,
  installPresetBinaries,
  installBasicCommands,
  BASIC_SYSTEM_COMMANDS,
  type PresetInstallResult,
  // Dynamic wrapper management
  getAvailableWrappers,
  getWrapperDefinition,
  generateWrapperContent,
  getDefaultWrapperConfig,
  wrapperUsesSeatbelt,
  wrapperUsesInterceptor,
  addDynamicWrapper,
  removeDynamicWrapper,
  updateWrapper,
  type WrapperResult,
  type WrapperDefinition,
  type WrapperConfig,
} from './wrappers/wrappers.js';

// Seatbelt profiles (enforcement)
export {
  generateAgentProfile,
  generateOperationProfile,
  installProfiles,
  installSeatbeltProfiles,
  verifyProfile,
  getInstalledProfiles,
  type ProfileResult,
} from './enforcement/seatbelt.js';

// LaunchDaemon (enforcement)
export {
  generateBrokerPlist,
  installLaunchDaemon,
  loadLaunchDaemon,
  unloadLaunchDaemon,
  uninstallLaunchDaemon,
  isDaemonRunning,
  getDaemonStatus,
  restartDaemon,
  fixSocketPermissions,
  type DaemonResult,
} from './enforcement/launchdaemon.js';

// Presets (Preset System)
export {
  // Registry functions
  getPreset,
  resolvePresetId,
  listPresets,
  listAutoDetectablePresets,
  autoDetectPreset,
  formatPresetList,
  // Preset instances
  openclawPreset,
  claudeCodePreset,
  devHarnessPreset,
  customPreset,
  PRESETS,
  // Types
  type TargetPreset,
  type PresetDetectionResult,
  type MigrationContext,
  type MigrationDirectories,
  type PresetMigrationResult,
  type InstallContext,
  type InstallResult,
  type ClaudeConfigCategory,
  DEFAULT_CLAUDE_CONFIG_CATEGORIES,
} from './presets/index.js';

// Install Pipeline (step-based)
export {
  runPipeline,
  getOpenclawPipeline,
  getClaudeCodePipeline,
  type InstallStep,
  type StepResult,
  type PipelineState,
  type PipelineOptions,
  type PipelineResult,
  type CheckResult,
  type StepUser,
  // Rollback
  registerRollback,
  getRollbackHandler,
  getRegisteredRollbackSteps,
  ROLLBACK_HANDLERS_REGISTERED,
  type RollbackContext,
  type RollbackHandler,
} from './presets/index.js';

// Discovery (binary + skill scanning)
export {
  scanDiscovery,
  scanBinaries,
  scanSkills,
  parseSkillMd,
  extractSkillInfo,
  classifyDirectory,
  stripEnvFromSkillMd,
} from './detection/discovery/index.js';

// ES Extension (embedded .app path resolver)
export { getESExtensionAppPath } from './inject/es-extension.js';

// Skill Injector (AgenCo skill injection)
export {
  injectAgenCoSkill,
  createAgenCoSymlink,
  removeInjectedSkills,
  updateOpenClawMcpConfig,
  getSkillsDir,
  getAgenCoSkillPath,
  type SkillInjectionResult,
} from './inject/skill-injector.js';

// PATH Router Override
export {
  generateRouterWrapper,
  buildInstallRouterCommands,
  buildRemoveRouterCommands,
  buildInstallUserLocalRouterCommands,
  buildRemoveUserLocalRouterCommands,
  findOriginalBinary,
  isRouterWrapper,
  scanForRouterWrappers,
  readPathRegistry,
  writePathRegistry,
  addRegistryInstance,
  removeRegistryInstance,
  pathRegistryPath,
  ROUTER_MARKER,
  type PathRegistry,
  type PathRegistryEntry,
  type PathRegistryInstance,
} from './wrappers/path-override.js';

// Legacy (single-file removal target)
export {
  GUARDED_SHELL_PATH, ZDOT_DIR, ZDOT_ZSHENV_CONTENT,
  SHIELD_EXEC_PATH, SHIELD_EXEC_CONTENT, PATH_REGISTRY_PATH,
  userExistsSync, deleteSandboxUser, createSandboxUser,
  createGuardedShell, backupOriginalConfig, generateBrokerPlistLegacy,
} from './legacy.js';

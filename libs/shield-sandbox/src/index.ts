/**
 * AgenShield Sandbox Library
 *
 * User isolation and sandboxing utilities for OpenClaw.
 * Handles creation of restricted users, guarded shells,
 * and directory structures for sandboxed execution.
 *
 * @packageDocumentation
 */

// Types (primary type definitions)
export type { SandboxUser, SandboxConfig, CreateUserResult, DirectoryStructure as SandboxDirectoryStructure } from './types';

// Guarded shell
export * from './guarded-shell';

// macos.ts (sandbox user management utilities)
export {
  createGuardedShell,
  createSandboxUser,
  deleteSandboxUser,
} from './macos';

// New users management (Phase 5)
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
  type CreateResult,
} from './users';

// Directories management (Phase 5)
export {
  createDirectoryStructure,
  createPathsConfig,
  createDirectory,
  createSystemDirectories,
  createAgentDirectories,
  createAllDirectories,
  verifyDirectories,
  setupSocketDirectory,
  getDirectoryInfo,
  removeAllDirectories,
  type DirectoryDefinition,
  type DirectoryStructure,
  type DirectoryResult,
} from './directories';

// Migration
export * from './migration';

// Security
export * from './security';

// Detection
export * from './detect';

// Backup & Restore
export * from './backup';
export * from './restore';

// Shield-Exec (unified command proxy)
export {
  SHIELD_EXEC_CONTENT,
  SHIELD_EXEC_PATH,
  PROXIED_COMMANDS,
} from './shield-exec';

// Wrappers (Phase 5)
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
} from './wrappers';

// Seatbelt profiles (Phase 5)
export {
  generateAgentProfile,
  generateOperationProfile,
  installProfiles,
  installSeatbeltProfiles,
  verifyProfile,
  getInstalledProfiles,
  type ProfileResult,
} from './seatbelt';

// LaunchDaemon (Phase 5)
export {
  generateBrokerPlist,
  generateBrokerPlistLegacy,
  installLaunchDaemon,
  loadLaunchDaemon,
  unloadLaunchDaemon,
  uninstallLaunchDaemon,
  isDaemonRunning,
  getDaemonStatus,
  restartDaemon,
  type DaemonResult,
} from './launchdaemon';

// Presets (Preset System)
export {
  // Registry functions
  getPreset,
  listPresets,
  listAutoDetectablePresets,
  autoDetectPreset,
  formatPresetList,
  // Preset instances
  openclawPreset,
  customPreset,
  PRESETS,
  // Types
  type TargetPreset,
  type PresetDetectionResult,
  type MigrationContext,
  type MigrationDirectories,
  type PresetMigrationResult,
} from './presets';

// Discovery (binary + skill scanning)
export {
  scanDiscovery,
  scanBinaries,
  scanSkills,
  parseSkillMd,
  classifyDirectory,
} from './discovery';

// Skill Injector (AgentLink skill injection)
export {
  injectAgentLinkSkill,
  createAgentLinkSymlink,
  removeInjectedSkills,
  updateOpenClawMcpConfig,
  getSkillsDir,
  getAgentLinkSkillPath,
  type SkillInjectionResult,
} from './skill-injector';

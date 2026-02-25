/**
 * AgenShield Daemon
 *
 * HTTP server that serves the UI and provides API endpoints
 * for configuration and status.
 *
 * @packageDocumentation
 */

export { createServer, startServer } from './server';
export { loadConfig, saveConfig, updateConfig, ensureConfigDir } from './config/index';
export { getConfigDir, getConfigPath, getPidPath, getLogPath } from './config/paths';
export { getDefaultConfig, VERSION } from './config/defaults';
export { getVault, resetVault, Vault } from './vault/index';
export { loadState, saveState, updateState, addUserState } from './state/index';
export { isRunningAsRoot } from './auth/passcode';

// Skills watcher
export {
  startSkillsWatcher,
  stopSkillsWatcher,
  approveSkill,
  rejectSkill,
  revokeSkill,
  listUntrusted,
  listApproved,
  triggerSkillsScan,
  computeSkillHash,
  updateApprovedHash,
  type ApprovedSkillEntry,
  type UntrustedSkillInfo,
} from './watchers/skills';

/**
 * CLI Commands
 *
 * Exports all command registration functions for the main CLI.
 */

export { registerSetupCommand } from './setup.js';
export { registerStatusCommand } from './status.js';
export { registerDoctorCommand } from './doctor.js';
export { registerUninstallCommand } from './uninstall.js';
export { registerDevCommands } from './dev.js';
export { registerStartCommand } from './start.js';
export { registerStopCommand } from './stop.js';
export { registerUpgradeCommand } from './upgrade.js';
export { registerInstallCommand } from './install.js';
export { registerLogsCommand } from './logs.js';
export { registerExecCommand } from './exec.js';
export { registerAuthCommands } from './auth-cmd.js';
export { registerCompletionCommand } from './completion.js';
export { registerServiceCommand } from './service.js';
export { withGlobals, withGlobalsPositional, handleError } from './base.js';

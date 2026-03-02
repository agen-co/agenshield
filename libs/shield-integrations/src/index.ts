/**
 * AgenShield Integrations
 *
 * OpenClaw and third-party integration utilities.
 * Extracted from @agenshield/sandbox to break circular dependency
 * with @agenshield/broker.
 *
 * @packageDocumentation
 */

// Homebrew (agent-local Homebrew installation)
export {
  installAgentHomebrew,
  isAgentHomebrewInstalled,
  type HomebrewInstallResult,
} from './homebrew';

// OpenClaw Installation (agent sandbox OpenClaw setup)
export {
  detectHostOpenClawVersion,
  installAgentOpenClaw,
  copyOpenClawConfig,
  stopHostOpenClaw,
  getOriginalUser,
  getHostOpenClawConfigPath,
  onboardAgentOpenClaw,
  startAgentOpenClawGateway,
  startAgentOpenClawDashboard,
  type OpenClawInstallResult,
  type OpenClawConfigCopyResult,
  type StopHostOpenClawResult,
} from './openclaw-install';

// AgenShield Daemon LaunchDaemon (daemon service management)
export {
  generateDaemonPlist,
  installDaemonService,
  startDaemonService,
  stopDaemonService,
  uninstallDaemonService,
  getDaemonServiceStatus,
  type DaemonServiceConfig,
  type DaemonServiceStatus,
  type DaemonServiceResult,
} from './daemon-launchdaemon';

// AgenShield Privilege Helper LaunchDaemon (root privilege helper)
export {
  generatePrivilegeHelperPlist,
  installPrivilegeHelperService,
  startPrivilegeHelperService,
  stopPrivilegeHelperService,
  uninstallPrivilegeHelperService,
  getPrivilegeHelperServiceStatus,
} from './privilege-helper-launchdaemon';

// OpenClaw LaunchDaemon (gateway process lifecycle)
export {
  generateOpenClawGatewayPlist,
  installOpenClawLauncher,
  installOpenClawLaunchDaemons,
  startOpenClawServices,
  stopOpenClawServices,
  restartOpenClawServices,
  getOpenClawStatus,
  getOpenClawStatusSync,
  getOpenClawDashboardUrl,
  isOpenClawInstalled,
  uninstallOpenClawLaunchDaemons,
  OPENCLAW_GATEWAY_LABEL,
  OPENCLAW_DAEMON_PLIST,
  OPENCLAW_GATEWAY_PLIST,
  OPENCLAW_LAUNCHER_PATH,
  type OpenClawLaunchConfig,
  type OpenClawProcessStatus,
  type OpenClawStatus,
  type OpenClawDaemonResult,
} from './openclaw-launchdaemon';

// Menu Bar LaunchAgent (user-level menu bar app lifecycle)
export {
  installMenuBarAgent,
  uninstallMenuBarAgent,
  getMenuBarAgentStatus,
  MENUBAR_LABEL,
  MENUBAR_PLIST_NAME,
  type MenuBarAgentResult,
  type MenuBarAgentStatus,
} from './menubar-launchagent';

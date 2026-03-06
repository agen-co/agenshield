/**
 * Service definitions and lifecycle management.
 * Service definitions and lifecycle management for macOS LaunchDaemons/Agents.
 */

export {
  installAgentHomebrew,
  isAgentHomebrewInstalled,
  type HomebrewInstallResult,
} from './homebrew';

export {
  detectHostOpenClawVersion,
  detectHostOpenClawVersionAsync,
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

export {
  generatePrivilegeHelperPlist,
  installPrivilegeHelperService,
  startPrivilegeHelperService,
  stopPrivilegeHelperService,
  uninstallPrivilegeHelperService,
  getPrivilegeHelperServiceStatus,
} from './privilege-helper-launchdaemon';

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

export {
  installMenuBarAgent,
  uninstallMenuBarAgent,
  getMenuBarAgentStatus,
  MENUBAR_LABEL,
  MENUBAR_PLIST_NAME,
  type MenuBarAgentResult,
  type MenuBarAgentStatus,
} from './menubar-launchagent';

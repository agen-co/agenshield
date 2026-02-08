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
  type OpenClawInstallResult,
  type OpenClawConfigCopyResult,
  type StopHostOpenClawResult,
} from './openclaw-install';

// OpenClaw LaunchDaemon (daemon/gateway process lifecycle)
export {
  generateOpenClawDaemonPlist,
  generateOpenClawGatewayPlist,
  installOpenClawLauncher,
  installOpenClawLaunchDaemons,
  startOpenClawServices,
  stopOpenClawServices,
  restartOpenClawServices,
  getOpenClawStatus,
  getOpenClawStatusSync,
  isOpenClawInstalled,
  uninstallOpenClawLaunchDaemons,
  OPENCLAW_DAEMON_LABEL,
  OPENCLAW_GATEWAY_LABEL,
  OPENCLAW_DAEMON_PLIST,
  OPENCLAW_GATEWAY_PLIST,
  OPENCLAW_LAUNCHER_PATH,
  type OpenClawLaunchConfig,
  type OpenClawProcessStatus,
  type OpenClawStatus,
  type OpenClawDaemonResult,
} from './openclaw-launchdaemon';

/**
 * OpenClaw detection module
 *
 * Re-exports from @agenshield/sandbox for backwards compatibility.
 * The detection logic has been moved to shield-sandbox so it can
 * be shared between the CLI and daemon.
 */

export {
  type InstallMethod,
  type OpenClawInstallation,
  type DetectionResult,
  type PrerequisitesResult,
  type SecurityStatus,
  detectOpenClaw,
  checkPrerequisites,
  checkSecurityStatus,
} from '@agenshield/sandbox';

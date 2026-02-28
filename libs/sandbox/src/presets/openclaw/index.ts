/**
 * OpenClaw Install Steps
 *
 * OpenClaw-specific step objects and pipeline definition.
 */

export { getOpenclawPipeline } from './pipeline.js';
export { cleanBrewLocksStep } from './clean-brew-locks.js';
export { installOpenclawStep } from './install-openclaw.js';
export { onboardOpenclawStep } from './onboard-openclaw.js';
export { verifyOpenclawStep } from './verify-openclaw.js';
export { detectHostOpenclawStep } from './detect-host-openclaw.js';
export { copyOpenclawConfigStep } from './copy-openclaw-config.js';
export { rewriteOpenclawPathsStep } from './rewrite-openclaw-paths.js';
export { enforceOpenclawConfigStep } from './enforce-openclaw-config.js';
export {
  OPENCLAW_CONFIG_ENFORCEMENTS,
  resolveEnforcements,
  matchesVersion,
  type ConfigEnforcement,
  type ConfigEnforcementRule,
  type ConfigPatch,
} from './config-enforcements.js';
export { injectSkillsStep } from './inject-skills.js';
export { writeGatewayPlistStep } from './write-gateway-plist.js';

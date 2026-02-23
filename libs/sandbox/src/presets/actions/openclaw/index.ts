/**
 * OpenClaw Install Steps
 *
 * OpenClaw-specific step objects and pipeline definition.
 */

export { getOpenclawPipeline } from './pipeline.js';
export { cleanBrewLocksStep } from './clean-brew-locks.js';
export { installOpenclawStep } from './install-openclaw.js';
export { verifyOpenclawStep } from './verify-openclaw.js';
export { detectHostOpenclawStep } from './detect-host-openclaw.js';
export { copyOpenclawConfigStep } from './copy-openclaw-config.js';
export { rewriteOpenclawPathsStep } from './rewrite-openclaw-paths.js';
export { writeGatewayPlistStep } from './write-gateway-plist.js';

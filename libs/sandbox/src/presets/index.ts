/**
 * Preset System
 *
 * Provides a registry of target presets for AgenShield.
 * Each preset defines how to detect, migrate, and run a specific application.
 */

import type { TargetPreset, PresetDetectionResult } from './types.js';
import type { TargetType } from '@agenshield/ipc';
import { openclawPreset } from './openclaw/preset.js';
import { claudeCodePreset } from './claude-code/preset.js';
import { devHarnessPreset } from './dev-harness/preset.js';
import { customPreset } from './custom/preset.js';

// Re-export types (includes both preset types and pipeline step types)
export * from './types.js';

// Re-export pipeline runner
export { runPipeline } from './runner.js';

// Re-export rollback registry
export {
  registerRollback,
  getRollbackHandler,
  getRegisteredRollbackSteps,
  type RollbackContext,
  type RollbackHandler,
} from './rollback-registry.js';

// Re-export rollback handlers (side-effect: registers all handlers on import)
export { ROLLBACK_HANDLERS_REGISTERED } from './rollbacks/index.js';

// Re-export shared steps
export * from './shared/index.js';

// Re-export preset pipelines
export { getOpenclawPipeline } from './openclaw/index.js';
export { getClaudeCodePipeline } from './claude-code/index.js';

// Re-export individual presets
export { openclawPreset } from './openclaw/preset.js';
export { claudeCodePreset } from './claude-code/preset.js';
export { devHarnessPreset } from './dev-harness/preset.js';
export { customPreset } from './custom/preset.js';

/**
 * All available presets
 * Order matters: openclaw is preferred over dev-harness when both exist.
 * 'custom' is excluded from auto-detection by listAutoDetectablePresets().
 */
export const PRESETS: Record<TargetType, TargetPreset> = {
  openclaw: openclawPreset,
  'claude-code': claudeCodePreset,
  'dev-harness': devHarnessPreset,
  custom: customPreset,
};

/**
 * Resolve an instance ID (e.g. 'claude-code-1') to its base preset ID ('claude-code').
 * Returns the input unchanged if it's already a valid preset ID or no base match is found.
 */
export function resolvePresetId(instanceId: string): TargetType {
  if (PRESETS[instanceId as TargetType]) return instanceId as TargetType;
  const match = instanceId.match(/^(.+)-(\d+)$/);
  if (match && PRESETS[match[1] as TargetType]) return match[1] as TargetType;
  return 'custom';
}

/**
 * Get preset by ID
 *
 * @param id - Preset identifier
 * @returns The preset or undefined if not found
 */
export function getPreset(id: TargetType | string): TargetPreset | undefined {
  return PRESETS[id as TargetType];
}

/**
 * List all available presets
 *
 * @returns Array of all presets
 */
export function listPresets(): TargetPreset[] {
  return Object.values(PRESETS);
}

/**
 * List presets that can auto-detect (excludes 'custom')
 *
 * @returns Array of auto-detectable presets
 */
export function listAutoDetectablePresets(): TargetPreset[] {
  return Object.values(PRESETS).filter((preset) => preset.id !== 'custom');
}

/**
 * Auto-detect which preset matches the current system
 * Returns the first matching preset found.
 *
 * @returns Object with preset and detection result, or null if none found
 */
export async function autoDetectPreset(): Promise<{
  preset: TargetPreset;
  detection: PresetDetectionResult;
} | null> {
  for (const preset of listAutoDetectablePresets()) {
    const detection = await preset.detect();
    if (detection?.found || detection?.configPath) {
      return { preset, detection };
    }
  }
  return null;
}

/**
 * Format preset list for display
 *
 * @returns Formatted string showing available presets
 */
export function formatPresetList(): string {
  const lines: string[] = ['Available presets:', ''];

  for (const preset of listPresets()) {
    const autoDetect = preset.id !== 'custom' ? ' (auto-detectable)' : ' (requires --entry-point)';
    lines.push(`  ${preset.id.padEnd(12)} - ${preset.description}${autoDetect}`);
  }

  return lines.join('\n');
}

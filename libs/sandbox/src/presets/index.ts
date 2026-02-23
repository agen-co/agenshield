/**
 * Preset System
 *
 * Provides a registry of target presets for AgenShield.
 * Each preset defines how to detect, migrate, and run a specific application.
 */

import type { TargetPreset, PresetDetectionResult } from './types.js';
import { openclawPreset } from './openclaw.js';
import { claudeCodePreset } from './claude-code.js';
import { devHarnessPreset } from './dev-harness.js';
import { customPreset } from './custom.js';

// Re-export types
export * from './types.js';

// Re-export install pipeline
export * from './actions/index.js';

// Re-export individual presets
export { openclawPreset } from './openclaw.js';
export { claudeCodePreset } from './claude-code.js';
export { devHarnessPreset } from './dev-harness.js';
export { customPreset } from './custom.js';

/**
 * All available presets
 * Order matters: openclaw is preferred over dev-harness when both exist.
 * 'custom' is excluded from auto-detection by listAutoDetectablePresets().
 */
export const PRESETS: Record<string, TargetPreset> = {
  openclaw: openclawPreset,
  'claude-code': claudeCodePreset,
  'dev-harness': devHarnessPreset,
  custom: customPreset,
};

/**
 * Resolve an instance ID (e.g. 'claude-code-1') to its base preset ID ('claude-code').
 * Returns the input unchanged if it's already a valid preset ID or no base match is found.
 */
export function resolvePresetId(instanceId: string): string {
  if (PRESETS[instanceId]) return instanceId;
  const match = instanceId.match(/^(.+)-(\d+)$/);
  if (match && PRESETS[match[1]]) return match[1];
  return instanceId;
}

/**
 * Get preset by ID
 *
 * @param id - Preset identifier
 * @returns The preset or undefined if not found
 */
export function getPreset(id: string): TargetPreset | undefined {
  return PRESETS[id];
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

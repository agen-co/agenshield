/**
 * Preset System
 *
 * Provides a registry of target presets for AgenShield.
 * Each preset defines how to detect, migrate, and run a specific application.
 */

import type { TargetPreset, PresetDetectionResult } from './types.js';
import { openclawPreset } from './openclaw.js';
import { devHarnessPreset } from './dev-harness.js';
import { customPreset } from './custom.js';

// Re-export types
export * from './types.js';

// Re-export individual presets
export { openclawPreset } from './openclaw.js';
export { devHarnessPreset } from './dev-harness.js';
export { customPreset } from './custom.js';

/**
 * All available presets
 * Order matters: openclaw is preferred over dev-harness when both exist.
 * 'custom' is excluded from auto-detection by listAutoDetectablePresets().
 */
export const PRESETS: Record<string, TargetPreset> = {
  openclaw: openclawPreset,
  'dev-harness': devHarnessPreset,
  custom: customPreset,
};

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

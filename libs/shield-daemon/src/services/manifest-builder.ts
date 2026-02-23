/**
 * ManifestBuilder
 *
 * Accumulates ManifestEntry records during the shield process.
 * Infrastructure steps call recordInfra()/skipInfra(), and
 * preset pipeline entries are merged via mergePresetEntries().
 */

import type { ManifestEntry, InstallManifest } from '@agenshield/ipc';

export class ManifestBuilder {
  private readonly entries: ManifestEntry[] = [];

  constructor(private readonly presetId: string) {}

  /** Record a completed infrastructure step */
  recordInfra(
    stepId: string,
    phase: number,
    outputs: Record<string, string>,
    changed = true,
  ): void {
    this.entries.push({
      stepId,
      phase,
      changed,
      status: 'completed',
      outputs,
      completedAt: new Date().toISOString(),
      layer: 'infra',
    });
  }

  /** Record a skipped infrastructure step */
  skipInfra(stepId: string, phase: number): void {
    this.entries.push({
      stepId,
      phase,
      changed: false,
      status: 'skipped',
      outputs: {},
      completedAt: new Date().toISOString(),
      layer: 'infra',
    });
  }

  /** Record a failed infrastructure step */
  failInfra(stepId: string, phase: number): void {
    this.entries.push({
      stepId,
      phase,
      changed: false,
      status: 'failed',
      outputs: {},
      completedAt: new Date().toISOString(),
      layer: 'infra',
    });
  }

  /** Append preset pipeline entries (returned by runPipeline) */
  mergePresetEntries(entries: ManifestEntry[]): void {
    this.entries.push(...entries);
  }

  /** Build the final manifest */
  build(): InstallManifest {
    return {
      version: '1.0',
      presetId: this.presetId,
      createdAt: new Date().toISOString(),
      entries: this.entries,
    };
  }
}

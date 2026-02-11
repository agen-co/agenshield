/**
 * Analyze adapter interfaces
 */

import type { SkillVersion, SkillFile, AnalysisResult } from '@agenshield/ipc';

/** Adapter for pluggable skill analyzers. Multiple adapters can run together. */
export interface AnalyzeAdapter {
  /** Unique adapter identifier */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Run analysis on a skill version + its files. */
  analyze(version: SkillVersion, files: SkillFile[]): AnalysisResult | Promise<AnalysisResult>;
}

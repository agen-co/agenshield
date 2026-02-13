/**
 * BasicAnalyzeAdapter — Built-in analyzer that parses manifest, extracts bins/env/commands
 */

import type { SkillVersion, SkillFile, AnalysisResult } from '@agenshield/ipc';
import type { AnalyzeAdapter } from '../types';

export class BasicAnalyzeAdapter implements AnalyzeAdapter {
  readonly id = 'basic';
  readonly displayName = 'Basic Analyzer';

  analyze(version: SkillVersion, files: SkillFile[]): AnalysisResult {
    const requiredBins: string[] = [...version.requiredBins];
    const requiredEnv: string[] = [...version.requiredEnv];
    const extractedCommands: string[] = [];

    // Look for common patterns in file names
    const hasManifest = files.some((f) =>
      f.relativePath === 'SKILL.md' || f.relativePath === 'skill.json' || f.relativePath === 'package.json',
    );

    // Extract from metadata if available
    if (version.metadataJson && typeof version.metadataJson === 'object') {
      const meta = version.metadataJson as Record<string, unknown>;
      if (Array.isArray(meta.requiredBins)) {
        for (const bin of meta.requiredBins) {
          if (typeof bin === 'string' && !requiredBins.includes(bin)) requiredBins.push(bin);
        }
      }
      if (Array.isArray(meta.requiredEnv)) {
        for (const env of meta.requiredEnv) {
          if (typeof env === 'string' && !requiredEnv.includes(env)) requiredEnv.push(env);
        }
      }
      if (Array.isArray(meta.commands)) {
        for (const cmd of meta.commands) {
          if (typeof cmd === 'string') extractedCommands.push(cmd);
        }
      }
    }

    return {
      status: 'success',
      data: { hasManifest, fileCount: files.length },
      requiredBins,
      requiredEnv,
      extractedCommands,
    };
  }
}

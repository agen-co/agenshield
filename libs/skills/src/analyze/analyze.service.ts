/**
 * Analyze service — Skill version analysis with pluggable adapters
 */

import type { AnalysisResult } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { EventEmitter } from 'node:events';
import type { SkillEvent } from '../events';
import type { AnalyzeAdapter } from './types';
import { VersionNotFoundError } from '../errors';
import * as crypto from 'node:crypto';

const STATUS_PRIORITY: Record<string, number> = { success: 0, warning: 1, error: 2 };

function statusPriority(status: string): number {
  return STATUS_PRIORITY[status] ?? 0;
}

function mergeResults(results: Array<{ adapterId: string; result: AnalysisResult }>): AnalysisResult {
  const bins = new Set<string>();
  const envs = new Set<string>();
  const cmds = new Set<string>();
  let worstStatus: AnalysisResult['status'] = 'success';
  const mergedData: Record<string, unknown> = {};

  for (const { adapterId, result } of results) {
    result.requiredBins.forEach((b) => bins.add(b));
    result.requiredEnv.forEach((e) => envs.add(e));
    result.extractedCommands.forEach((c) => cmds.add(c));
    if (statusPriority(result.status) > statusPriority(worstStatus)) worstStatus = result.status;
    mergedData[adapterId] = result.data;
  }

  // If only one adapter, unwrap its data directly for backward compat
  const data = results.length === 1 ? results[0].result.data : mergedData;

  return {
    status: worstStatus,
    data,
    requiredBins: [...bins],
    requiredEnv: [...envs],
    extractedCommands: [...cmds],
  };
}

export class AnalyzeService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly adapters: AnalyzeAdapter[],
    private readonly emitter: EventEmitter,
  ) {}

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  async analyzeVersion(versionId: string): Promise<AnalysisResult> {
    const operationId = crypto.randomUUID();
    this.emit({ type: 'analyze:started', operationId, versionId });

    try {
      const version = this.skills.getVersionById(versionId);
      if (!version) throw new VersionNotFoundError(versionId);

      const skill = this.skills.getById(version.skillId);
      const skillSlug = skill?.slug ?? 'unknown';

      this.emit({
        type: 'analyze:parsing',
        progress: {
          operationId, skillSlug,
          step: 'parsing-manifest', stepIndex: 0, totalSteps: 3,
          message: 'Parsing manifest...',
        },
      });

      const files = this.skills.getFiles(versionId);

      this.emit({
        type: 'analyze:extracting',
        progress: {
          operationId, skillSlug,
          step: 'extracting-metadata', stepIndex: 1, totalSteps: 3,
          message: 'Extracting metadata...',
        },
      });

      // Run all adapters and merge results
      const adapterResults = await Promise.all(
        this.adapters.map(async (adapter) => ({
          adapterId: adapter.id,
          result: await adapter.analyze(version, files),
        })),
      );

      const result = mergeResults(adapterResults);

      // Persist analysis result
      this.skills.updateAnalysis(versionId, {
        status: result.status === 'success' ? 'complete' : 'error',
        json: result,
        analyzedAt: new Date().toISOString(),
      });

      this.emit({ type: 'analyze:completed', operationId, versionId, result });
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'analyze:error', operationId, versionId, error: errorMsg });
      throw err;
    }
  }

  async analyzePending(): Promise<AnalysisResult[]> {
    const allSkills = this.skills.getAll();
    const results: AnalysisResult[] = [];

    for (const skill of allSkills) {
      const versions = this.skills.getVersions(skill.id);
      for (const version of versions) {
        if (version.analysisStatus === 'pending') {
          results.push(await this.analyzeVersion(version.id));
        }
      }
    }

    return results;
  }

  async reanalyze(versionId: string): Promise<AnalysisResult> {
    // Reset status then re-analyze
    this.skills.updateAnalysis(versionId, { status: 'pending' });
    return this.analyzeVersion(versionId);
  }
}

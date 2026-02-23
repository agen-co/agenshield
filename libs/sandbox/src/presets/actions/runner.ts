/**
 * Pipeline Runner
 *
 * Executes an ordered array of InstallStep objects sequentially.
 * Supports idempotency checks, skip predicates, dynamic step injection,
 * weight-based progress tracking, and optional saga-style rollback.
 */

import type { InstallContext } from '../types.js';
import type { ManifestEntry } from '@agenshield/ipc';
import type { InstallStep, PipelineOptions, PipelineState, PipelineResult, StepResult } from './types.js';
import { StepExecutionError } from '../../errors.js';

/**
 * Simple semver satisfies check for `versionRange` filtering.
 * Supports `>=X.Y.Z` and `<X.Y.Z` ranges. Returns true if no range is set.
 */
function satisfiesRange(version: string, range: string): boolean {
  const parseVersion = (v: string): number[] => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      if (a[i]! !== b[i]!) return a[i]! - b[i]!;
    }
    return 0;
  };

  const match = range.match(/^([<>]=?)(.+)$/);
  if (!match) return true;

  const [, op, rangeVer] = match;
  const v = parseVersion(version);
  const r = parseVersion(rangeVer!);
  const cmp = compare(v, r);

  switch (op) {
    case '>=': return cmp >= 0;
    case '>':  return cmp > 0;
    case '<=': return cmp <= 0;
    case '<':  return cmp < 0;
    default:   return true;
  }
}

/**
 * Run a pipeline of install steps sequentially.
 *
 * Steps are filtered by versionRange, checked for skip/idempotency,
 * and executed in order. Dynamic step injection via resolve() is supported.
 */
export async function runPipeline(
  steps: InstallStep[],
  ctx: InstallContext,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const pipeline = [...steps];
  const state: PipelineState = { outputs: {} };
  const completedSteps: InstallStep[] = [];
  const manifestEntries: ManifestEntry[] = [];
  const totalWeight = pipeline.reduce((sum, s) => sum + s.weight, 0);
  let completedWeight = 0;

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i]!;

    // 1. Version range filter
    if (step.versionRange && options?.version && options.version !== 'latest') {
      if (!satisfiesRange(options.version, step.versionRange)) {
        ctx.onLog(`Skipping "${step.name}" — version ${options.version} outside range ${step.versionRange}`);
        manifestEntries.push({
          stepId: step.id, phase: step.phase, changed: false, status: 'skipped',
          outputs: {}, completedAt: new Date().toISOString(), layer: 'preset',
        });
        completedWeight += step.weight;
        continue;
      }
    }

    // 2. Skip predicate
    if (step.skip?.(ctx, state)) {
      ctx.onLog(`Skipping "${step.name}" — skip condition met`);
      manifestEntries.push({
        stepId: step.id, phase: step.phase, changed: false, status: 'skipped',
        outputs: {}, completedAt: new Date().toISOString(), layer: 'preset',
      });
      completedWeight += step.weight;
      continue;
    }

    // 3. Idempotency check
    if (step.check) {
      try {
        const checkResult = await step.check(ctx, state);
        if (checkResult === 'satisfied') {
          ctx.onLog(`Skipping "${step.name}" — already satisfied`);
          manifestEntries.push({
            stepId: step.id, phase: step.phase, changed: false, status: 'skipped',
            outputs: {}, completedAt: new Date().toISOString(), layer: 'preset',
          });
          completedWeight += step.weight;
          continue;
        }
      } catch {
        // check() failed — proceed to run() anyway
      }
    }

    // 4. Emit progress
    const progress = Math.round((completedWeight / totalWeight) * 100);
    ctx.onProgress(step.id, progress, step.progressMessage);
    ctx.onLog(`Step: ${step.name}`);
    options?.onStepStart?.(step, i, pipeline.length);

    // 5. Dynamic step injection (resolve before run)
    if (step.resolve) {
      const injected = step.resolve(ctx, state);
      if (injected && injected.length > 0) {
        pipeline.splice(i + 1, 0, ...injected);
        ctx.onLog(`Injected ${injected.length} additional step(s) after "${step.name}"`);
      }
    }

    // 6. Execute
    let result: StepResult;
    try {
      result = await step.run(ctx, state);
    } catch (err) {
      const message = (err as Error).message;
      ctx.onLog(`Step "${step.name}" failed: ${message}`);

      // Optional saga-style rollback
      if (options?.rollbackOnFailure) {
        for (let j = completedSteps.length - 1; j >= 0; j--) {
          const completed = completedSteps[j]!;
          if (completed.rollback) {
            try {
              ctx.onLog(`Rolling back "${completed.name}"...`);
              await completed.rollback(ctx, state);
            } catch {
              // Best-effort rollback
            }
          }
        }
      }

      manifestEntries.push({
        stepId: step.id, phase: step.phase, changed: false, status: 'failed',
        outputs: {}, completedAt: new Date().toISOString(), layer: 'preset',
      });

      return {
        success: false,
        failedStep: step.id,
        error: err instanceof StepExecutionError ? message : `Step "${step.id}" failed: ${message}`,
        manifestEntries,
      };
    }

    // 7. Record manifest entry
    manifestEntries.push({
      stepId: step.id, phase: step.phase, changed: result.changed,
      status: 'completed', outputs: result.outputs ?? {},
      completedAt: new Date().toISOString(), layer: 'preset',
    });

    // 8. Merge outputs
    if (result.outputs) {
      for (const [key, value] of Object.entries(result.outputs)) {
        state.outputs[`${step.id}.${key}`] = value;
      }
    }

    // 9. Log warnings
    if (result.warnings) {
      for (const warning of result.warnings) {
        ctx.onLog(`Warning [${step.name}]: ${warning}`);
      }
    }

    completedWeight += step.weight;
    completedSteps.push(step);
    options?.onStepComplete?.(step, result, i);
  }

  // All steps completed
  ctx.onProgress('complete', 100, 'Installation complete');
  return { success: true, manifestEntries };
}

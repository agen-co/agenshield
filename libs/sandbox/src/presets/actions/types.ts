/**
 * Install Step Pipeline Types
 *
 * Defines the step-based pipeline interface for preset installation.
 * Each step is a plain object with a uniform interface — no class inheritance.
 * Inspired by Ansible's check-then-act pattern and the saga pattern for rollback.
 */

import type { InstallContext, InstallResult } from '../types.js';
import type { HostShellConfigBackup } from '../install-helpers.js';
import type { ManifestEntry } from '@agenshield/ipc';

/** Which OS user runs the step's commands */
export type StepUser = 'root' | 'agent' | 'mixed';

/** Result of checking whether a step needs to run */
export type CheckResult = 'needed' | 'satisfied' | 'error';

/** Result of executing a step */
export interface StepResult {
  /** Whether the step actually changed anything (Ansible-style) */
  changed: boolean;
  /** Key-value outputs for downstream steps (e.g., { nodePath: '/path/to/node' }) */
  outputs?: Record<string, string>;
  /** Warning messages (non-fatal) */
  warnings?: string[];
}

/** Accumulated pipeline state — shared mutable bag across steps */
export interface PipelineState {
  /** Merged outputs from completed steps, keyed by `stepId.outputKey` */
  outputs: Record<string, string>;
  /** Shell config backups for save/restore pattern */
  shellBackups?: HostShellConfigBackup[];
}

/** A single install step — the atomic unit of the pipeline */
export interface InstallStep {
  /** Unique ID — matches ShieldStepDefinition.id for SSE (e.g., 'install_homebrew') */
  id: string;
  /** Short display name (e.g., 'Install Homebrew') */
  name: string;
  /** Longer description for logs and expandable UI rows */
  description: string;
  /** Phase number (maps to SHIELD_PHASE_LABELS for UI grouping) */
  phase: number;
  /** Message shown in shield-ui progress area while this step runs */
  progressMessage: string;
  /** Which user(s) the step runs commands as */
  runsAs: StepUser;
  /** Default timeout in ms */
  timeout: number;
  /** Relative weight for progress calculation (runner normalizes to %) */
  weight: number;
  /** Semver range — step skipped if target version doesn't satisfy */
  versionRange?: string;

  /**
   * Idempotency check — is this step already satisfied?
   * Called before run(). Return 'satisfied' to skip, 'needed' to execute.
   * Optional — when omitted, step always runs.
   */
  check?: (ctx: InstallContext, state: PipelineState) => Promise<CheckResult>;

  /**
   * Skip predicate — return true to skip entirely.
   * Different from check(): skip() is for pipeline logic (e.g., freshInstall),
   * check() is for idempotency (e.g., "brew already installed").
   */
  skip?: (ctx: InstallContext, state: PipelineState) => boolean;

  /**
   * Dynamic step injection — examine context/state and request
   * additional steps to be inserted into the pipeline.
   * Called after check(), before run(). Injected steps run AFTER this step.
   */
  resolve?: (ctx: InstallContext, state: PipelineState) => InstallStep[] | null;

  /** Execute the step. Throw to fail. Return StepResult on success. */
  run: (ctx: InstallContext, state: PipelineState) => Promise<StepResult>;

  /** Optional compensating action — called if a LATER step fails (saga pattern). */
  rollback?: (ctx: InstallContext, state: PipelineState) => Promise<void>;
}

/** Pipeline result — extends InstallResult with manifest data */
export interface PipelineResult extends InstallResult {
  /** Manifest entries for all steps that ran in this pipeline */
  manifestEntries: ManifestEntry[];
}

/** Options for the pipeline runner */
export interface PipelineOptions {
  /** Target version for semver filtering */
  version?: string;
  /** Called before each step starts */
  onStepStart?: (step: InstallStep, index: number, total: number) => void;
  /** Called after each step completes */
  onStepComplete?: (step: InstallStep, result: StepResult, index: number) => void;
  /** Enable rollback on failure (saga pattern) */
  rollbackOnFailure?: boolean;
}

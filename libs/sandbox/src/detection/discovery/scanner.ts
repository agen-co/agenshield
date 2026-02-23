/**
 * Discovery Orchestrator
 *
 * Top-level scan that combines binary scanning, skill scanning,
 * and computes a summary of the system state.
 */

import type {
  DiscoveryOptions,
  DiscoveryResult,
  DiscoverySummary,
  DiscoveredBinary,
  BinaryDirectory,
  DiscoveredSkill,
  ExecutionContext,
  ProtectionKind,
  BinarySourceKind,
} from '@agenshield/ipc';
import { scanBinaries } from './binary-scanner';
import { scanSkills } from './skill-scanner';

/**
 * Compute summary statistics from scan results
 */
function computeSummary(
  binaries: DiscoveredBinary[],
  directories: BinaryDirectory[],
  skills: DiscoveredSkill[],
): DiscoverySummary {
  const byContext: Record<ExecutionContext, number> = { root: 0, user: 0, workspace: 0 };
  const byProtection: Record<ProtectionKind, number> = {
    proxied: 0,
    wrapped: 0,
    allowed: 0,
    unprotected: 0,
  };
  const bySourceKind: Partial<Record<BinarySourceKind, number>> = {};

  for (const bin of binaries) {
    for (const ctx of bin.contexts) {
      byContext[ctx]++;
    }
    byProtection[bin.protection]++;
    bySourceKind[bin.sourceKind] = (bySourceKind[bin.sourceKind] ?? 0) + 1;
  }

  const skillsWithMissingDeps = skills.filter((s) =>
    s.requiredCommands.some((c) => c.required && !c.available),
  ).length;

  return {
    totalBinaries: binaries.length,
    totalDirectories: directories.length,
    totalSkills: skills.length,
    byContext,
    byProtection,
    bySourceKind,
    skillsWithMissingDeps,
  };
}

/**
 * Run a full discovery scan: binaries, skills, and summary
 */
export function scanDiscovery(options: DiscoveryOptions): DiscoveryResult {
  // 1. Scan binaries
  const { binaries, directories } = scanBinaries(options);

  // 2. Build lookup map for skill cross-referencing
  const binaryLookup = new Map(binaries.map((b) => [b.name, b]));

  // 3. Scan skills if requested
  const skills =
    options.scanSkills && options.agentHome
      ? scanSkills(options, binaryLookup)
      : [];

  // 4. Compute summary
  const summary = computeSummary(binaries, directories, skills);

  return {
    scannedAt: new Date().toISOString(),
    binaries,
    directories,
    skills,
    summary,
  };
}

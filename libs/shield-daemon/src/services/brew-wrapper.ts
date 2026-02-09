/**
 * Brew Binary Wrapper System
 *
 * When a skill declares a brew dependency, after `brew install` succeeds we:
 *   1. Discover the installed binaries
 *   2. Relocate the originals to .brew-originals/
 *   3. Create policy-context-injecting wrappers in {agentHome}/bin/
 *
 * This makes the wrappers generic (wrapping any brew binary) while tagging
 * them with skill ownership context for policy enforcement.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { PROXIED_COMMANDS, BASIC_SYSTEM_COMMANDS } from '@agenshield/sandbox';
import { writeFileViaBroker, copyFileViaBroker, mkdirViaBroker, isBrokerAvailable } from './broker-bridge';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BrewFormulaEntry {
  /** Skills that requested this formula */
  installedBy: string[];
  /** Binary names provided by this formula */
  binaries: string[];
  /** ISO timestamp of first install */
  installedAt: string;
}

export interface BrewBinaryEntry {
  /** Brew formula that provides this binary */
  formula: string;
  /** Skills that use this binary (via the formula) */
  owningSkills: string[];
  /** Path to relocated original binary */
  originalPath: string;
  /** Path to wrapper script */
  wrapperPath: string;
}

export interface BrewManifest {
  version: string;
  formulas: Record<string, BrewFormulaEntry>;
  binaries: Record<string, BrewBinaryEntry>;
}

export interface BrewWrapperResult {
  success: boolean;
  binariesWrapped: string[];
  errors: string[];
}

export interface BrewUninstallResult {
  removed: string[];
  kept: string[];
  errors: string[];
}

// ─── Protected command sets ─────────────────────────────────────────────────

const PROTECTED_COMMANDS = new Set([
  ...PROXIED_COMMANDS,
  ...BASIC_SYSTEM_COMMANDS,
]);

/** Characters allowed in binary/formula names (prevent shell injection) */
const SAFE_NAME_RE = /^[a-zA-Z0-9_.\-]+$/;

// ─── Manifest I/O ───────────────────────────────────────────────────────────

export function getManifestPath(agentHome: string): string {
  return path.join(agentHome, '.agenshield', 'brew-manifest.json');
}

function emptyManifest(): BrewManifest {
  return { version: '1.0.0', formulas: {}, binaries: {} };
}

export function loadManifest(agentHome: string): BrewManifest {
  const manifestPath = getManifestPath(agentHome);
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as BrewManifest;
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(agentHome: string, manifest: BrewManifest): Promise<void> {
  const manifestPath = getManifestPath(agentHome);
  const dir = path.dirname(manifestPath);
  const content = JSON.stringify(manifest, null, 2) + '\n';

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(manifestPath, content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      try {
        if (await isBrokerAvailable()) {
          await mkdirViaBroker(dir);
          await writeFileViaBroker(manifestPath, content);
          return;
        }
      } catch (brokerErr) {
        console.warn(`[brew-wrapper] Broker fallback failed for saveManifest: ${(brokerErr as Error).message}`);
      }
      console.warn(`[brew-wrapper] Cannot write manifest (EACCES, broker unavailable): ${manifestPath}`);
    } else {
      throw err;
    }
  }
}

// ─── Binary Discovery ───────────────────────────────────────────────────────

/**
 * Discover binaries installed by a brew formula.
 *
 * Phase 1: use `metadataBins` from skill metadata if declared.
 * Phase 2: run `brew list <formula>` as agent user, filter to homebrew/bin/ entries.
 * Filters out any names that conflict with PROXIED_COMMANDS or BASIC_SYSTEM_COMMANDS.
 */
export function discoverBrewBinaries(options: {
  formula: string;
  metadataBins?: string[];
  agentHome: string;
  agentUsername: string;
}): string[] {
  const { formula, metadataBins, agentHome, agentUsername } = options;
  const binNames = new Set<string>();

  // Phase 1: declared bins from skill metadata
  if (metadataBins && metadataBins.length > 0) {
    for (const bin of metadataBins) {
      if (SAFE_NAME_RE.test(bin)) {
        binNames.add(bin);
      }
    }
  }

  // Phase 2: discover via `brew list`
  try {
    const brewCmd = [
      `export HOME="${agentHome}"`,
      `export PATH="${agentHome}/homebrew/bin:$PATH"`,
      `brew list ${formula}`,
    ].join(' && ');

    const output = execSync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${brewCmd}'`,
      { encoding: 'utf-8', timeout: 10_000, cwd: '/' },
    );

    const homebrewBinDir = path.join(agentHome, 'homebrew', 'bin') + '/';
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith(homebrewBinDir)) {
        const binName = path.basename(trimmed);
        if (SAFE_NAME_RE.test(binName)) {
          binNames.add(binName);
        }
      }
    }
  } catch {
    // brew list may fail — rely on metadataBins
  }

  // Filter out conflicts with system wrappers
  const result: string[] = [];
  for (const name of binNames) {
    if (PROTECTED_COMMANDS.has(name)) {
      // Skip — never overwrite system wrappers
      continue;
    }
    result.push(name);
  }

  return result;
}

// ─── Binary Relocation ──────────────────────────────────────────────────────

/**
 * Relocate a brew-installed binary from homebrew/bin/ to .brew-originals/.
 *
 * Resolves the symlink in {agentHome}/homebrew/bin/<cmd> to the Cellar path,
 * copies the Cellar binary to .brew-originals/<cmd>, and removes the symlink.
 * Idempotent — skips if already relocated.
 */
export async function relocateBrewBinary(options: {
  binaryName: string;
  agentHome: string;
}): Promise<{ success: boolean; originalPath: string; error?: string }> {
  const { binaryName, agentHome } = options;
  const originalsDir = path.join(agentHome, 'bin', '.brew-originals');
  const originalPath = path.join(originalsDir, binaryName);

  // Already relocated
  if (fs.existsSync(originalPath)) {
    return { success: true, originalPath };
  }

  // Ensure originals directory exists (root-owned, mode 0755)
  if (!fs.existsSync(originalsDir)) {
    try {
      fs.mkdirSync(originalsDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EACCES') {
        try {
          if (await isBrokerAvailable()) {
            await mkdirViaBroker(originalsDir);
          } else {
            return { success: false, originalPath, error: `Cannot create originals dir (EACCES, broker unavailable)` };
          }
        } catch (brokerErr) {
          return { success: false, originalPath, error: `Cannot create originals dir: ${(brokerErr as Error).message}` };
        }
      } else {
        return { success: false, originalPath, error: `Cannot create originals dir: ${(err as Error).message}` };
      }
    }
  }

  // Find the brew symlink
  const brewBinPath = path.join(agentHome, 'homebrew', 'bin', binaryName);
  let realBinaryPath: string;

  try {
    if (!fs.existsSync(brewBinPath)) {
      return {
        success: false,
        originalPath,
        error: `Brew binary not found: ${brewBinPath}`,
      };
    }

    // Resolve symlink to Cellar path
    const stat = fs.lstatSync(brewBinPath);
    if (stat.isSymbolicLink()) {
      realBinaryPath = fs.realpathSync(brewBinPath);
    } else {
      realBinaryPath = brewBinPath;
    }
  } catch (err) {
    return {
      success: false,
      originalPath,
      error: `Cannot resolve brew binary: ${(err as Error).message}`,
    };
  }

  // Copy the real binary to .brew-originals/
  try {
    fs.copyFileSync(realBinaryPath, originalPath);
    const stat = fs.statSync(realBinaryPath);
    fs.chmodSync(originalPath, stat.mode);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      try {
        if (await isBrokerAvailable()) {
          const stat = fs.statSync(realBinaryPath);
          await copyFileViaBroker(realBinaryPath, originalPath, stat.mode);
        } else {
          return { success: false, originalPath, error: `Cannot copy binary (EACCES, broker unavailable)` };
        }
      } catch (brokerErr) {
        return { success: false, originalPath, error: `Cannot copy binary via broker: ${(brokerErr as Error).message}` };
      }
    } else {
      return { success: false, originalPath, error: `Cannot copy binary: ${(err as Error).message}` };
    }
  }

  // Remove the symlink from homebrew/bin/ to prevent bypass
  try {
    fs.unlinkSync(brewBinPath);
  } catch {
    // Best-effort — may already be gone or unwritable
  }

  return { success: true, originalPath };
}

// ─── Wrapper Generation ─────────────────────────────────────────────────────

/**
 * Generate a bash wrapper script for a brew-installed binary.
 * The wrapper injects skill context env vars and executes the original binary.
 */
export function generateBrewWrapper(options: {
  cmd: string;
  slug: string;
  formula: string;
  agentHome: string;
}): string {
  const { cmd, slug, formula, agentHome } = options;
  return [
    '#!/bin/bash',
    `# ${cmd} - AgenShield brew wrapper (auto-generated)`,
    `# Skill: ${slug} | Formula: ${formula}`,
    'if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi',
    '',
    '# Policy check - block execution if denied by policy',
    `POLICY_RESULT=$(/opt/agenshield/bin/shield-client check-exec "${cmd}" 2>/dev/null)`,
    'if [ $? -ne 0 ]; then',
    `  echo "AgenShield: execution of '${cmd}' denied by policy" >&2`,
    '  exit 126',
    'fi',
    '',
    '# Inject skill context for downstream policy engine',
    'export AGENSHIELD_CONTEXT_TYPE=skill',
    `export AGENSHIELD_SKILL_SLUG="${slug}"`,
    '',
    '# Execute the original binary',
    `exec "${agentHome}/bin/.brew-originals/${cmd}" "$@"`,
    '',
  ].join('\n');
}

/**
 * Write a brew wrapper script to {agentHome}/bin/<cmd>.
 */
export async function installBrewWrapper(options: {
  cmd: string;
  slug: string;
  formula: string;
  agentHome: string;
  socketGroup: string;
}): Promise<void> {
  const { cmd, slug, formula, agentHome, socketGroup } = options;
  const wrapperPath = path.join(agentHome, 'bin', cmd);
  const content = generateBrewWrapper({ cmd, slug, formula, agentHome });

  try {
    fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      if (await isBrokerAvailable()) {
        await writeFileViaBroker(wrapperPath, content, { mode: 0o755 });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  // Set ownership: root:<socketGroup>
  try {
    execSync(`chown root:${socketGroup} "${wrapperPath}"`, { stdio: 'pipe' });
    execSync(`chmod 755 "${wrapperPath}"`, { stdio: 'pipe' });
  } catch {
    // May fail if not root — acceptable in development
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Install brew binary wrappers for a formula installed by a skill.
 *
 * 1. Discovers binaries from the formula
 * 2. Loads/updates the manifest
 * 3. For each binary: relocates original + creates wrapper (or adds skill to owners)
 * 4. Saves updated manifest
 */
export async function installBrewBinaryWrappers(options: {
  slug: string;
  formula: string;
  metadataBins?: string[];
  agentHome: string;
  agentUsername: string;
  socketGroup: string;
  onLog: (msg: string) => void;
}): Promise<BrewWrapperResult> {
  const { slug, formula, metadataBins, agentHome, agentUsername, socketGroup, onLog } = options;
  const binariesWrapped: string[] = [];
  const errors: string[] = [];

  // 1. Discover binaries
  const bins = discoverBrewBinaries({ formula, metadataBins, agentHome, agentUsername });
  if (bins.length === 0) {
    onLog(`No wrappable binaries found for formula: ${formula}`);
    return { success: true, binariesWrapped, errors };
  }

  onLog(`Found ${bins.length} binary(ies) for ${formula}: ${bins.join(', ')}`);

  // 2. Load manifest
  const manifest = loadManifest(agentHome);

  // 3. Process each binary
  for (const bin of bins) {
    const existingBinary = manifest.binaries[bin];

    if (existingBinary) {
      // Binary already managed — add this skill as an owner
      if (!existingBinary.owningSkills.includes(slug)) {
        existingBinary.owningSkills.push(slug);
        onLog(`Added ${slug} as co-owner of ${bin} (existing brew wrapper)`);
      }
      binariesWrapped.push(bin);
      continue;
    }

    // New binary — relocate + create wrapper
    const relocation = await relocateBrewBinary({ binaryName: bin, agentHome });
    if (!relocation.success) {
      errors.push(`Failed to relocate ${bin}: ${relocation.error}`);
      continue;
    }

    try {
      await installBrewWrapper({ cmd: bin, slug, formula, agentHome, socketGroup });
    } catch (err) {
      errors.push(`Failed to create wrapper for ${bin}: ${(err as Error).message}`);
      continue;
    }

    // Update manifest
    manifest.binaries[bin] = {
      formula,
      owningSkills: [slug],
      originalPath: relocation.originalPath,
      wrapperPath: path.join(agentHome, 'bin', bin),
    };

    binariesWrapped.push(bin);
    onLog(`Wrapped brew binary: ${bin}`);
  }

  // Update formula entry
  if (!manifest.formulas[formula]) {
    manifest.formulas[formula] = {
      installedBy: [slug],
      binaries: bins,
      installedAt: new Date().toISOString(),
    };
  } else {
    const formulaEntry = manifest.formulas[formula];
    if (!formulaEntry.installedBy.includes(slug)) {
      formulaEntry.installedBy.push(slug);
    }
    // Merge any newly discovered binaries
    for (const bin of bins) {
      if (!formulaEntry.binaries.includes(bin)) {
        formulaEntry.binaries.push(bin);
      }
    }
  }

  // 4. Save manifest
  try {
    await saveManifest(agentHome, manifest);
  } catch (err) {
    errors.push(`Failed to save manifest: ${(err as Error).message}`);
  }

  return {
    success: errors.length === 0,
    binariesWrapped,
    errors,
  };
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

/** Standard system paths for brew uninstall */
const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Uninstall brew binary wrappers for a skill.
 *
 * For each formula/binary owned by this skill:
 *   - If sole owner: remove wrapper, remove original, run `brew uninstall`, remove from manifest
 *   - If shared: remove slug from owningSkills, update wrapper to next owner's slug
 */
export async function uninstallBrewBinaryWrappers(options: {
  slug: string;
  agentHome: string;
  agentUsername: string;
  onLog: (msg: string) => void;
}): Promise<BrewUninstallResult> {
  const { slug, agentHome, agentUsername, onLog } = options;
  const removed: string[] = [];
  const kept: string[] = [];
  const errors: string[] = [];

  const manifest = loadManifest(agentHome);
  let manifestChanged = false;

  // Find all binaries owned by this skill
  const ownedBinaries = Object.entries(manifest.binaries).filter(
    ([, entry]) => entry.owningSkills.includes(slug),
  );

  if (ownedBinaries.length === 0) {
    return { removed, kept, errors };
  }

  // Track formulas to potentially uninstall
  const formulasToCheck = new Set<string>();

  for (const [binName, entry] of ownedBinaries) {
    formulasToCheck.add(entry.formula);

    if (entry.owningSkills.length === 1) {
      // Sole owner — remove everything
      const wrapperPath = path.join(agentHome, 'bin', binName);
      try {
        if (fs.existsSync(wrapperPath)) {
          fs.unlinkSync(wrapperPath);
        }
      } catch (err) {
        errors.push(`Failed to remove wrapper ${binName}: ${(err as Error).message}`);
      }

      // Remove original from .brew-originals/
      try {
        if (fs.existsSync(entry.originalPath)) {
          fs.unlinkSync(entry.originalPath);
        }
      } catch (err) {
        errors.push(`Failed to remove original ${binName}: ${(err as Error).message}`);
      }

      delete manifest.binaries[binName];
      manifestChanged = true;
      removed.push(binName);
      onLog(`Removed brew wrapper: ${binName}`);
    } else {
      // Shared — remove this skill from owners, update wrapper
      entry.owningSkills = entry.owningSkills.filter((s) => s !== slug);
      manifestChanged = true;

      // Update the wrapper to use the next owner's slug
      const nextSlug = entry.owningSkills[0];
      const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
      try {
        await installBrewWrapper({
          cmd: binName,
          slug: nextSlug,
          formula: entry.formula,
          agentHome,
          socketGroup,
        });
        onLog(`Updated brew wrapper ${binName}: new primary owner → ${nextSlug}`);
      } catch (err) {
        errors.push(`Failed to update wrapper ${binName}: ${(err as Error).message}`);
      }

      kept.push(binName);
    }
  }

  // Check formulas: uninstall if no remaining binaries reference them
  for (const formula of formulasToCheck) {
    const formulaEntry = manifest.formulas[formula];
    if (!formulaEntry) continue;

    // Remove this skill from formula's installedBy
    formulaEntry.installedBy = formulaEntry.installedBy.filter((s) => s !== slug);

    // Check if any binaries still reference this formula
    const hasRemainingBinaries = Object.values(manifest.binaries).some(
      (b) => b.formula === formula,
    );

    if (!hasRemainingBinaries && formulaEntry.installedBy.length === 0) {
      // No binaries left, no skills referencing — uninstall the formula
      try {
        const brewCmd = [
          `export HOME="${agentHome}"`,
          `export PATH="${agentHome}/homebrew/bin:${agentHome}/bin:${SYSTEM_PATH}:$PATH"`,
          `brew uninstall ${formula} 2>/dev/null || true`,
        ].join(' && ');

        execSync(
          `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${brewCmd}'`,
          { timeout: 30_000, cwd: '/', stdio: 'pipe' },
        );
        onLog(`Uninstalled brew formula: ${formula}`);
      } catch (err) {
        errors.push(`Failed to uninstall formula ${formula}: ${(err as Error).message}`);
      }

      delete manifest.formulas[formula];
      manifestChanged = true;
    }
  }

  // Save manifest
  if (manifestChanged) {
    try {
      await saveManifest(agentHome, manifest);
    } catch (err) {
      errors.push(`Failed to save manifest: ${(err as Error).message}`);
    }
  }

  return { removed, kept, errors };
}

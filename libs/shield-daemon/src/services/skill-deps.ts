/**
 * Skill Dependency Installer
 *
 * Parses install steps from skill metadata (openclaw/clawdbot)
 * and executes dependency installation commands as the agent user.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSkillMd, extractSkillInfo } from '@agenshield/sandbox';
import { execWithProgress } from '@agenshield/sandbox';
import { installBrewBinaryWrappers } from './brew-wrapper';
import { isDevMode } from '../config/paths';

/** Supported install step kinds */
const SUPPORTED_KINDS = new Set(['brew', 'npm', 'pip']);

/** Characters allowed in formula/package names (prevent shell injection) */
const SAFE_PACKAGE_RE = /^[a-zA-Z0-9@/_.\-]+$/;

/** Standard system paths — ensures brew/npm/pip/binaries are reachable even when the daemon's inherited PATH is restricted */
const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Recursively search for SKILL.md or README.md in a directory tree.
 * (Same logic as findSkillMdRecursive in routes/skills.ts)
 */
function findSkillMdRecursive(dir: string, depth = 0): string | null {
  if (depth > 3) return null;
  try {
    for (const name of ['SKILL.md', 'skill.md', 'README.md', 'readme.md']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = findSkillMdRecursive(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  } catch {
    // Directory may not exist or be unreadable
  }
  return null;
}

export interface SkillDepsResult {
  success: boolean;
  installed: string[];
  errors: string[];
}

/**
 * Execute skill dependency install steps declared in skill metadata.
 *
 * Reads the skill's SKILL.md, parses YAML frontmatter, extracts install
 * steps from metadata.openclaw.install or metadata.clawdbot.install,
 * and runs supported package manager commands as the agent user.
 *
 * Dependency install failures are non-fatal — the caller should treat
 * errors as warnings since the skill files are already installed.
 */
export async function executeSkillInstallSteps(options: {
  slug: string;
  skillDir: string;
  agentHome: string;
  agentUsername: string;
  socketGroup?: string;
  onLog: (msg: string) => void;
}): Promise<SkillDepsResult> {
  const { slug, skillDir, agentHome, agentUsername, onLog } = options;
  const socketGroup = options.socketGroup || process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
  const installed: string[] = [];
  const errors: string[] = [];

  // 1. Find and read skill.md
  const skillMdPath = findSkillMdRecursive(skillDir);
  if (!skillMdPath) {
    return { success: true, installed, errors }; // No skill.md = no deps
  }

  let content: string;
  try {
    content = fs.readFileSync(skillMdPath, 'utf-8');
  } catch {
    return { success: true, installed, errors };
  }

  // 2. Parse metadata
  const parsed = parseSkillMd(content);
  if (!parsed) {
    return { success: true, installed, errors };
  }

  // 3. Extract install steps (check both openclaw and clawdbot keys)
  const info = extractSkillInfo(parsed.metadata);
  const installSteps = info.installSteps;

  if (!Array.isArray(installSteps) || installSteps.length === 0) {
    return { success: true, installed, errors };
  }

  onLog(`Found ${installSteps.length} dependency install step(s) for ${slug}`);

  // 4. Execute each step
  for (const step of installSteps) {
    const kind = step.kind;
    const stepId = step.id || kind;

    if (!SUPPORTED_KINDS.has(kind)) {
      errors.push(`Unsupported install kind "${kind}" (step: ${stepId})`);
      continue;
    }

    try {
      switch (kind) {
        case 'brew': {
          const formula = step.formula;
          if (!formula) {
            errors.push(`Brew step "${stepId}" missing formula`);
            break;
          }
          if (!SAFE_PACKAGE_RE.test(formula)) {
            errors.push(`Unsafe brew formula name: ${formula}`);
            break;
          }
          onLog(`Installing brew formula: ${formula}`);
          const brewCmd = [
            `export HOME="${agentHome}"`,
            `export PATH="${agentHome}/homebrew/bin:${agentHome}/bin:${SYSTEM_PATH}:$PATH"`,
            `brew install ${formula}`,
          ].join(' && ');

          const brewExec = isDevMode()
            ? `/bin/bash --norc --noprofile -c '${brewCmd}'`
            : `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${brewCmd}'`;
          await execWithProgress(brewExec, onLog, { timeout: 120_000, cwd: '/' });
          installed.push(formula);

          // Create policy-enforcing wrappers for brew-installed binaries
          try {
            const wrapResult = await installBrewBinaryWrappers({
              slug,
              formula,
              metadataBins: step.bins,
              agentHome,
              agentUsername,
              socketGroup,
              onLog,
            });
            if (wrapResult.binariesWrapped.length > 0) {
              onLog(`Wrapped brew binaries: ${wrapResult.binariesWrapped.join(', ')}`);
            }
            if (wrapResult.errors.length > 0) {
              for (const err of wrapResult.errors) {
                errors.push(err);
              }
            }
          } catch (wrapErr) {
            errors.push(`Brew wrapper creation failed: ${(wrapErr as Error).message}`);
          }
          break;
        }

        case 'npm': {
          const pkg = (step as Record<string, unknown>)['package'] as string | undefined;
          if (!pkg) {
            errors.push(`npm step "${stepId}" missing package`);
            break;
          }
          if (!SAFE_PACKAGE_RE.test(pkg)) {
            errors.push(`Unsafe npm package name: ${pkg}`);
            break;
          }
          onLog(`Installing npm package: ${pkg}`);
          const npmGlobalDir = `${agentHome}/.npm-global`;

          // Ensure npm global dir exists (may already exist from sandbox setup)
          try {
            const mkdirExec = isDevMode()
              ? `/bin/mkdir -p "${npmGlobalDir}"`
              : `sudo -H -u ${agentUsername} /bin/mkdir -p "${npmGlobalDir}"`;
            await execWithProgress(mkdirExec, () => {}, { timeout: 5_000, cwd: '/' });
          } catch { /* best-effort — dir may already exist */ }

          const npmCmd = [
            `export HOME="${agentHome}"`,
            `export NPM_CONFIG_PREFIX="${npmGlobalDir}"`,
            `export PATH="${npmGlobalDir}/bin:${agentHome}/bin:${SYSTEM_PATH}:$PATH"`,
            `source "${agentHome}/.nvm/nvm.sh" 2>/dev/null || true`,
            `npm install -g ${pkg}`,
          ].join(' && ');

          const npmExec = isDevMode()
            ? `/bin/bash --norc --noprofile -c '${npmCmd}'`
            : `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${npmCmd}'`;
          await execWithProgress(npmExec, onLog, { timeout: 60_000, cwd: '/' });
          installed.push(pkg);
          break;
        }

        case 'pip': {
          const pkg = (step as Record<string, unknown>)['package'] as string | undefined;
          if (!pkg) {
            errors.push(`pip step "${stepId}" missing package`);
            break;
          }
          if (!SAFE_PACKAGE_RE.test(pkg)) {
            errors.push(`Unsafe pip package name: ${pkg}`);
            break;
          }
          onLog(`Installing pip package: ${pkg}`);
          const pipCmd = [
            `export HOME="${agentHome}"`,
            `export PATH="${agentHome}/bin:${SYSTEM_PATH}:$PATH"`,
            `pip install ${pkg}`,
          ].join(' && ');

          const pipExec = isDevMode()
            ? `/bin/bash --norc --noprofile -c '${pipCmd}'`
            : `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${pipCmd}'`;
          await execWithProgress(pipExec, onLog, { timeout: 60_000, cwd: '/' });
          installed.push(pkg);
          break;
        }
      }
    } catch (err) {
      const msg = `Failed to install ${kind} dep (step: ${stepId}): ${(err as Error).message}`;
      onLog(msg);
      errors.push(msg);
    }
  }

  // 5. Verify required bins exist in agent's PATH
  const requiredBins = info.bins;
  if (requiredBins.length > 0) {
    onLog(`Verifying required binaries: ${requiredBins.join(', ')}`);
    for (const bin of requiredBins) {
      try {
        const checkCmd = [
          `export HOME="${agentHome}"`,
          `export PATH="${agentHome}/.npm-global/bin:${agentHome}/homebrew/bin:${agentHome}/bin:${SYSTEM_PATH}:$PATH"`,
          `source "${agentHome}/.nvm/nvm.sh" 2>/dev/null || true`,
          `which ${bin}`,
        ].join(' && ');
        const checkExec = isDevMode()
          ? `/bin/bash --norc --noprofile -c '${checkCmd}'`
          : `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${checkCmd}'`;
        await execWithProgress(checkExec, () => {}, { timeout: 5_000, cwd: '/' });
      } catch {
        errors.push(`Required binary "${bin}" not found in agent PATH after install`);
      }
    }
  }

  return {
    success: errors.length === 0,
    installed,
    errors,
  };
}

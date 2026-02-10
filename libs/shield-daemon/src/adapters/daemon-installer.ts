/**
 * Daemon Skill Installer
 *
 * Implements SkillInstaller using the daemon's broker/sudo infrastructure.
 * Consolidates install/uninstall logic previously in integration-skills.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillInstaller, SkillDefinition, InstallOptions, UninstallOptions } from '@agenshield/skills';
import {
  getSkillsDir,
  addToApprovedList,
  removeFromApprovedList,
  computeSkillHash,
  updateApprovedHash,
} from '../watchers/skills';
import {
  installSkillViaBroker,
  uninstallSkillViaBroker,
  isBrokerAvailable,
} from '../services/broker-bridge';
import {
  addSkillPolicy,
  removeSkillPolicy,
  createSkillWrapper,
  removeSkillWrapper,
  sudoMkdir,
  sudoWriteFile,
  sudoRm,
} from '../services/skill-lifecycle';
import { injectInstallationTag } from '../services/skill-tag-injector';
import { storeDownloadedSkill, markDownloadedAsInstalled } from '../services/marketplace';
import { stripEnvFromSkillMd } from '@agenshield/sandbox';
import { AGENCO_PRESET } from '@agenshield/ipc';
import { daemonEvents, emitSkillInstallProgress, emitSkillUninstalled } from '../events/emitter';
import { loadConfig, updateConfig } from '../config';
import { syncCommandPolicies } from '../command-sync';

const MASTER_SKILL_NAME = 'agenco';

export class DaemonSkillInstaller implements SkillInstaller {

  async install(definition: SkillDefinition, options?: InstallOptions): Promise<void> {
    const skillsDir = getSkillsDir();
    if (!skillsDir) {
      throw new Error('Skills directory not configured');
    }

    const { skillId, files } = definition;

    // 1. Process files
    const processedFiles = await this.processFiles(files, options);

    // 2. Pre-approve to prevent watcher quarantine race
    addToApprovedList(skillId, definition.author);

    // 3. Write files via broker or sudo fallback
    const brokerAvailable = await isBrokerAvailable();
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const agentUsername = path.basename(agentHome);

    if (brokerAvailable) {
      await installSkillViaBroker(skillId, processedFiles, {
        createWrapper: options?.createWrapper,
      });
    } else {
      const destDir = path.join(skillsDir, skillId);
      await sudoMkdir(destDir, agentUsername);
      for (const file of processedFiles) {
        const filePath = path.join(destDir, file.name);
        const fileDir = path.dirname(filePath);
        if (fileDir !== destDir) {
          await sudoMkdir(fileDir, agentUsername);
        }
        await sudoWriteFile(filePath, file.content, agentUsername, file.mode);
      }
      if (options?.createWrapper) {
        const binDir = path.join(agentHome, 'bin');
        await createSkillWrapper(skillId, binDir);
      }
    }

    emitSkillInstallProgress(skillId, 'copy', 'Writing skill files');

    // 4. Add policy
    if (options?.addPolicy !== false) {
      addSkillPolicy(skillId);
    }

    // 5. Handle master skill preset policies
    if (definition.metadata?.['presetPolicies']) {
      const presetPolicies = definition.metadata['presetPolicies'] as typeof AGENCO_PRESET.policies;
      const config = loadConfig();
      let changed = false;
      for (const presetPolicy of presetPolicies) {
        if (!config.policies.some(p => p.id === presetPolicy.id)) {
          config.policies.push(presetPolicy);
          changed = true;
        }
      }
      if (changed) {
        updateConfig({ policies: config.policies });
        syncCommandPolicies(config.policies);
      }
    }

    // 6. Compute and store integrity hash
    const destDir = path.join(skillsDir, skillId);
    const hash = computeSkillHash(destDir);
    if (hash) {
      updateApprovedHash(skillId, hash);
    }

    // 7. Store in marketplace cache for GET /api/skills metadata
    try {
      storeDownloadedSkill(skillId, {
        name: definition.name,
        slug: skillId,
        author: definition.author ?? 'agenshield',
        version: definition.version,
        description: definition.description,
        tags: definition.tags ?? [],
        source: 'marketplace',
      }, processedFiles.map(f => ({ name: f.name, type: 'text/plain', content: f.content })));
      markDownloadedAsInstalled(skillId);
    } catch (err) {
      console.warn(`[DaemonInstaller] Failed to store marketplace cache for ${skillId}: ${(err as Error).message}`);
    }

    daemonEvents.broadcast('skills:installed', { name: skillId });
    console.log(`[DaemonInstaller] Installed skill: ${skillId}`);
  }

  async uninstall(skillId: string, options?: UninstallOptions): Promise<void> {
    const skillsDir = getSkillsDir();
    if (!skillsDir) return;

    const destDir = path.join(skillsDir, skillId);
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const binDir = path.join(agentHome, 'bin');

    const brokerAvailable = await isBrokerAvailable();
    if (brokerAvailable) {
      try {
        await uninstallSkillViaBroker(skillId, {
          removeWrapper: options?.removeWrapper,
          agentHome,
        });
      } catch {
        // Fallback to direct removal
        if (fs.existsSync(destDir)) {
          await sudoRm(destDir, path.basename(agentHome));
        }
        if (options?.removeWrapper) {
          removeSkillWrapper(skillId, binDir);
        }
      }
    } else {
      if (fs.existsSync(destDir)) {
        await sudoRm(destDir, path.basename(agentHome));
      }
      if (options?.removeWrapper) {
        removeSkillWrapper(skillId, binDir);
      }
    }

    removeFromApprovedList(skillId);

    if (options?.removePolicy !== false) {
      removeSkillPolicy(skillId);
    }

    // Handle master skill: remove preset policies
    if (skillId === MASTER_SKILL_NAME) {
      const config = loadConfig();
      const agencoIds = new Set(AGENCO_PRESET.policies.map(p => p.id));
      const filtered = config.policies.filter(p => !agencoIds.has(p.id));
      if (filtered.length !== config.policies.length) {
        updateConfig({ policies: filtered });
        syncCommandPolicies(filtered);
      }
    }

    emitSkillUninstalled(skillId);
    console.log(`[DaemonInstaller] Uninstalled skill: ${skillId}`);
  }

  isInstalled(skillId: string): boolean {
    const skillsDir = getSkillsDir();
    if (!skillsDir) return false;
    return fs.existsSync(path.join(skillsDir, skillId));
  }

  // ─── Private Helpers ────────────────────────────────────────

  private async processFiles(
    files: Array<{ name: string; content: string; mode?: number }>,
    options?: InstallOptions,
  ): Promise<Array<{ name: string; content: string; mode?: number }>> {
    const processed: Array<{ name: string; content: string; mode?: number }> = [];
    for (const file of files) {
      let content = file.content;
      if (/SKILL\.md$/i.test(file.name)) {
        if (options?.stripEnv) {
          content = stripEnvFromSkillMd(content);
        }
        if (options?.injectTag) {
          content = await injectInstallationTag(content);
        }
      }
      processed.push({ name: file.name, content, mode: file.mode });
    }
    return processed;
  }
}

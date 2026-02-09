/**
 * Integration Skills Service
 *
 * Dynamically generates and manages AgenCo integration skills based on
 * currently connected integrations. Uses broker install/uninstall for
 * proper permissions with direct-fs fallback for development.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILTIN_SKILLS_DIR } from '@agenshield/skills';
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
} from './broker-bridge';
import { addSkillPolicy, removeSkillPolicy, createSkillWrapper, removeSkillWrapper, sudoMkdir, sudoWriteFile, sudoRm } from './skill-lifecycle';
import { injectInstallationTag } from './skill-tag-injector';
import { storeDownloadedSkill, markDownloadedAsInstalled } from './marketplace';
import { stripEnvFromSkillMd } from '@agenshield/sandbox';
import { AGENCO_PRESET } from '@agenshield/ipc';
import { daemonEvents, emitSkillInstallProgress, emitSkillUninstalled } from '../events/emitter';
import { INTEGRATION_CATALOG } from '../data/integration-catalog';
import { loadState } from '../state';
import { loadConfig, updateConfig } from '../config';
import { syncCommandPolicies } from '../command-sync';

const MASTER_SKILL_NAME = 'agenco';
const INTEGRATION_SKILL_PREFIX = 'integration-';

export interface SyncResult {
  installed: string[];
  removed: string[];
  updated: string[];
  errors: string[];
}

// ─── Content generators ─────────────────────────────────────────────────────

/**
 * Generate the master SKILL.md by reading the bundled template and appending
 * a dynamic "Currently Connected Integrations" section.
 */
function generateMasterSkillMd(connectedIds: string[]): string {
  const templatePath = path.join(BUILTIN_SKILLS_DIR, MASTER_SKILL_NAME, 'SKILL.md');
  let template = fs.readFileSync(templatePath, 'utf-8');

  // Build the connected integrations section
  const lines: string[] = [
    '',
    '## Currently Connected Integrations',
    '',
  ];

  if (connectedIds.length === 0) {
    lines.push('No integrations are currently connected. Connect integrations from the Shield UI dashboard.');
  } else {
    lines.push('The following integrations are active and ready to use:');
    lines.push('');
    for (const id of connectedIds) {
      const details = INTEGRATION_CATALOG[id];
      if (details) {
        const actionCount = details.actions.length;
        lines.push(`- **${details.title}** (\`${id}\`) — ${actionCount} action${actionCount !== 1 ? 's' : ''} available`);
      } else {
        lines.push(`- **${id}**`);
      }
    }
  }

  lines.push('');

  // Append to template
  template = template.trimEnd() + '\n' + lines.join('\n');
  return template;
}

/**
 * Generate a per-integration SKILL.md from INTEGRATION_CATALOG data.
 * Returns null if the integration is not in the catalog.
 */
function generateIntegrationSkillMd(integrationId: string): string | null {
  const details = INTEGRATION_CATALOG[integrationId];
  if (!details) return null;

  const lines: string[] = [
    '---',
    `name: integration-${integrationId}`,
    `description: ${details.description}`,
    'user-invocable: false',
    'disable-model-invocation: false',
    '',
    'agenshield:',
    `  policy: builtin-integration-${integrationId}`,
    '  required-approval: false',
    '  audit-level: info',
    '  security-level: high',
    '---',
    '',
    `# ${details.title} Integration`,
    '',
    `${details.description}`,
    '',
    '## Available Actions',
    '',
    '| Action | Description |',
    '|--------|-------------|',
  ];

  for (const action of details.actions) {
    lines.push(`| \`${action.name}\` | ${action.description} |`);
  }

  lines.push('');
  lines.push('## Usage');
  lines.push('');
  lines.push(`Use the \`agenco\` skill to interact with ${details.title}.`);
  lines.push(`Search for tools with queries like: \`"${details.actions[0]?.name?.replace(/_/g, ' ') || `use ${integrationId}`}"\``);
  lines.push('');

  return lines.join('\n');
}

// ─── Install / Uninstall helpers ────────────────────────────────────────────

/**
 * Install (or update) the master agenco skill.
 */
async function installMasterSkill(connectedIds: string[]): Promise<void> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) {
    console.warn('[IntegrationSkills] Skills directory not configured — skipping master install');
    return;
  }

  // Generate dynamic SKILL.md
  let skillMd = generateMasterSkillMd(connectedIds);
  skillMd = stripEnvFromSkillMd(skillMd);
  skillMd = await injectInstallationTag(skillMd);

  // Read static files from bundled skill
  const binPath = path.join(BUILTIN_SKILLS_DIR, MASTER_SKILL_NAME, 'bin', 'agenco.mjs');
  const configPath = path.join(BUILTIN_SKILLS_DIR, MASTER_SKILL_NAME, 'config', 'mcp-template.json');

  const files: Array<{ name: string; content: string; mode?: number }> = [
    { name: 'SKILL.md', content: skillMd },
  ];

  if (fs.existsSync(binPath)) {
    files.push({ name: 'bin/agenco.mjs', content: fs.readFileSync(binPath, 'utf-8'), mode: 0o755 });
  }
  if (fs.existsSync(configPath)) {
    files.push({ name: 'config/mcp-template.json', content: fs.readFileSync(configPath, 'utf-8') });
  }

  // Pre-approve before writing to prevent watcher quarantine race
  addToApprovedList(MASTER_SKILL_NAME);

  const brokerAvailable = await isBrokerAvailable();
  if (brokerAvailable) {
    await installSkillViaBroker(MASTER_SKILL_NAME, files, { createWrapper: true });
  } else {
    // Dev fallback: use sudo helpers for proper permissions
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const agentUsername = path.basename(agentHome);
    const destDir = path.join(skillsDir, MASTER_SKILL_NAME);
    await sudoMkdir(destDir, agentUsername);
    for (const file of files) {
      const filePath = path.join(destDir, file.name);
      const fileDir = path.dirname(filePath);
      if (fileDir !== destDir) {
        await sudoMkdir(fileDir, agentUsername);
      }
      await sudoWriteFile(filePath, file.content, agentUsername, file.mode);
    }
    const binDir = path.join(agentHome, 'bin');
    await createSkillWrapper(MASTER_SKILL_NAME, binDir);
  }

  emitSkillInstallProgress(MASTER_SKILL_NAME, 'copy', 'Writing skill files');
  addSkillPolicy(MASTER_SKILL_NAME);

  // Add AgenCo preset policies (command + URL) if not already present
  const config = loadConfig();
  let changed = false;
  for (const presetPolicy of AGENCO_PRESET.policies) {
    if (!config.policies.some(p => p.id === presetPolicy.id)) {
      config.policies.push(presetPolicy);
      changed = true;
    }
  }
  if (changed) {
    updateConfig({ policies: config.policies });
    // Sync to broker's dynamic allowlist so agenco command is allowed
    syncCommandPolicies(config.policies);
  }

  // Update integrity hash
  const destDir = path.join(skillsDir, MASTER_SKILL_NAME);
  const hash = computeSkillHash(destDir);
  if (hash) {
    updateApprovedHash(MASTER_SKILL_NAME, hash);
  }

  // Store in marketplace cache so GET /api/skills returns full metadata
  try {
    storeDownloadedSkill(MASTER_SKILL_NAME, {
      name: 'AgenCo Secure Integrations',
      slug: MASTER_SKILL_NAME,
      author: 'agenshield',
      version: '1.0.0',
      description: 'Execute third-party integration tools through AgenCo secure cloud gateway',
      tags: ['integrations', 'agenco'],
      source: 'marketplace',
    }, files.map(f => ({ name: f.name, type: 'text/plain', content: f.content })));
    markDownloadedAsInstalled(MASTER_SKILL_NAME);
  } catch (err) {
    console.warn(`[IntegrationSkills] Failed to store marketplace cache for master skill: ${(err as Error).message}`);
  }

  daemonEvents.broadcast('skills:installed', { name: MASTER_SKILL_NAME });
  console.log(`[IntegrationSkills] Installed/updated master skill with ${connectedIds.length} integration(s)`);
}

/**
 * Install a per-integration documentation skill.
 */
async function installIntegrationSkill(integrationId: string): Promise<void> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) return;

  const skillName = `${INTEGRATION_SKILL_PREFIX}${integrationId}`;
  let skillMdContent = generateIntegrationSkillMd(integrationId);
  if (!skillMdContent) {
    // Integration not in catalog — graceful no-op
    return;
  }

  skillMdContent = stripEnvFromSkillMd(skillMdContent);
  const taggedContent = await injectInstallationTag(skillMdContent);
  const files = [{ name: 'SKILL.md', content: taggedContent }];

  addToApprovedList(skillName);

  const brokerAvailable = await isBrokerAvailable();
  if (brokerAvailable) {
    await installSkillViaBroker(skillName, files, { createWrapper: false });
  } else {
    // Dev fallback: use sudo helpers for proper permissions
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const agentUsername = path.basename(agentHome);
    const destDir = path.join(skillsDir, skillName);
    await sudoMkdir(destDir, agentUsername);
    for (const file of files) {
      const filePath = path.join(destDir, file.name);
      const fileDir = path.dirname(filePath);
      if (fileDir !== destDir) {
        await sudoMkdir(fileDir, agentUsername);
      }
      await sudoWriteFile(filePath, file.content, agentUsername);
    }
  }

  addSkillPolicy(skillName);

  const destDir = path.join(skillsDir, skillName);
  const hash = computeSkillHash(destDir);
  if (hash) {
    updateApprovedHash(skillName, hash);
  }

  // Store in marketplace cache so GET /api/skills returns full metadata
  const details = INTEGRATION_CATALOG[integrationId];
  try {
    storeDownloadedSkill(skillName, {
      name: details?.title ?? skillName,
      slug: skillName,
      author: 'agenshield',
      version: '1.0.0',
      description: details?.description ?? `AgenCo integration for ${integrationId}`,
      tags: ['integrations', 'agenco', integrationId],
      source: 'marketplace',
    }, files.map(f => ({ name: f.name, type: 'text/plain', content: f.content })));
    markDownloadedAsInstalled(skillName);
  } catch (err) {
    console.warn(`[IntegrationSkills] Failed to store marketplace cache for ${skillName}: ${(err as Error).message}`);
  }

  daemonEvents.broadcast('skills:installed', { name: skillName });
  console.log(`[IntegrationSkills] Installed integration skill: ${skillName}`);
}

/**
 * Uninstall a per-integration skill.
 */
async function uninstallIntegrationSkill(integrationId: string): Promise<void> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) return;

  const skillName = `${INTEGRATION_SKILL_PREFIX}${integrationId}`;
  const destDir = path.join(skillsDir, skillName);

  const brokerAvailable = await isBrokerAvailable();
  if (brokerAvailable) {
    try {
      await uninstallSkillViaBroker(skillName, { removeWrapper: false });
    } catch {
      if (fs.existsSync(destDir)) {
        const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
        await sudoRm(destDir, path.basename(agentHome));
      }
    }
  } else if (fs.existsSync(destDir)) {
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    await sudoRm(destDir, path.basename(agentHome));
  }

  removeFromApprovedList(skillName);
  removeSkillPolicy(skillName);
  emitSkillUninstalled(skillName);

  console.log(`[IntegrationSkills] Uninstalled integration skill: ${skillName}`);
}

/**
 * Uninstall the master skill.
 */
async function uninstallMasterSkill(): Promise<void> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) return;

  const destDir = path.join(skillsDir, MASTER_SKILL_NAME);

  const brokerAvailable = await isBrokerAvailable();
  if (brokerAvailable) {
    try {
      await uninstallSkillViaBroker(MASTER_SKILL_NAME, { removeWrapper: true });
    } catch {
      if (fs.existsSync(destDir)) {
        const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
        await sudoRm(destDir, path.basename(agentHome));
      }
    }
  } else {
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    if (fs.existsSync(destDir)) {
      await sudoRm(destDir, path.basename(agentHome));
    }
    const binDir = path.join(agentHome, 'bin');
    removeSkillWrapper(MASTER_SKILL_NAME, binDir);
  }

  removeFromApprovedList(MASTER_SKILL_NAME);
  removeSkillPolicy(MASTER_SKILL_NAME);

  // Remove AgenCo preset policies
  const config = loadConfig();
  const agencoIds = new Set(AGENCO_PRESET.policies.map(p => p.id));
  const filtered = config.policies.filter(p => !agencoIds.has(p.id));
  if (filtered.length !== config.policies.length) {
    updateConfig({ policies: filtered });
    syncCommandPolicies(filtered);
  }

  emitSkillUninstalled(MASTER_SKILL_NAME);
  console.log('[IntegrationSkills] Uninstalled master skill');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Sync all AgenCo integration skills based on current state.
 * Installs missing skills, removes orphaned ones, and updates the master skill.
 */
export async function syncAgenCoSkills(): Promise<SyncResult> {
  const result: SyncResult = { installed: [], removed: [], updated: [], errors: [] };

  const skillsDir = getSkillsDir();
  if (!skillsDir) {
    console.warn('[IntegrationSkills] Skills directory not configured — skipping sync');
    return result;
  }

  const state = loadState();
  const connectedIds = state.agenco.connectedIntegrations ?? [];

  // Scan for existing integration-* directories
  const existingIntegrationSkills = new Set<string>();
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(INTEGRATION_SKILL_PREFIX)) {
        existingIntegrationSkills.add(entry.name.slice(INTEGRATION_SKILL_PREFIX.length));
      }
    }
  } catch {
    // Skills directory may not exist yet
  }

  const connectedSet = new Set(connectedIds);

  // Install missing per-integration skills
  for (const id of connectedIds) {
    if (!existingIntegrationSkills.has(id)) {
      try {
        await installIntegrationSkill(id);
        result.installed.push(`${INTEGRATION_SKILL_PREFIX}${id}`);
      } catch (err) {
        result.errors.push(`install ${INTEGRATION_SKILL_PREFIX}${id}: ${(err as Error).message}`);
      }
    }
  }

  // Remove orphaned per-integration skills
  for (const existingId of existingIntegrationSkills) {
    if (!connectedSet.has(existingId)) {
      try {
        await uninstallIntegrationSkill(existingId);
        result.removed.push(`${INTEGRATION_SKILL_PREFIX}${existingId}`);
      } catch (err) {
        result.errors.push(`remove ${INTEGRATION_SKILL_PREFIX}${existingId}: ${(err as Error).message}`);
      }
    }
  }

  // Master skill: install/update if integrations connected, remove if none
  if (connectedIds.length > 0) {
    try {
      const masterExists = fs.existsSync(path.join(skillsDir, MASTER_SKILL_NAME));
      await installMasterSkill(connectedIds);
      if (masterExists) {
        result.updated.push(MASTER_SKILL_NAME);
      } else {
        result.installed.push(MASTER_SKILL_NAME);
      }
    } catch (err) {
      result.errors.push(`master skill: ${(err as Error).message}`);
    }
  } else {
    // No integrations — remove master skill if it exists
    if (fs.existsSync(path.join(skillsDir, MASTER_SKILL_NAME))) {
      try {
        await uninstallMasterSkill();
        result.removed.push(MASTER_SKILL_NAME);
      } catch (err) {
        result.errors.push(`remove master skill: ${(err as Error).message}`);
      }
    }
  }

  return result;
}

/**
 * Called when an integration is connected.
 * Installs the per-integration skill and updates the master skill.
 */
export async function onIntegrationConnected(integrationId: string): Promise<void> {
  await installIntegrationSkill(integrationId);

  // Update master skill with new connected integrations list
  const state = loadState();
  const connectedIds = state.agenco.connectedIntegrations ?? [];
  await installMasterSkill(connectedIds);
}

/**
 * Called when an integration is disconnected.
 * Removes the per-integration skill and updates (or removes) the master skill.
 */
export async function onIntegrationDisconnected(integrationId: string): Promise<void> {
  await uninstallIntegrationSkill(integrationId);

  // Update or remove master skill
  const state = loadState();
  const connectedIds = state.agenco.connectedIntegrations ?? [];
  if (connectedIds.length > 0) {
    await installMasterSkill(connectedIds);
  } else {
    await uninstallMasterSkill();
  }
}

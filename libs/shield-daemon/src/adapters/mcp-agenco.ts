/**
 * AgenCo MCP Connection
 *
 * Factory function that creates an MCPConnectionConfig for the AgenCo
 * MCP server. Implements tool discovery, skill generation, binary
 * requirements, and security instructions using the integration catalog.
 *
 * All skill generation logic (master + per-integration) lives here.
 * Content is generated entirely in-memory — no bundled templates on disk.
 */

import * as crypto from 'node:crypto';
import type {
  SourceSkillFile,
  SkillDefinition,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  TargetPlatform,
  ToolQuery,
} from '@agenshield/ipc';
import { AGENCO_PRESET } from '@agenshield/ipc';
import { INTEGRATION_CATALOG } from '../data/integration-catalog';
import type { MCPConnectionConfig } from './mcp-source';

const MASTER_SKILL_NAME = 'agenco';
const INTEGRATION_SKILL_PREFIX = 'agenco-';
const SOURCE_ID = 'mcp';

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Compute SHA-256 from an array of SourceSkillFile objects.
 */
function computeSkillDefinitionSha(files: SourceSkillFile[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const hash = crypto.createHash('sha256');
  for (const file of sorted) {
    hash.update(file.name);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

// ─── Content Generators ──────────────────────────────────────────

/**
 * Generate _meta.json content matching the OpenClaw skill metadata format.
 */
function generateMetaJson(slug: string, version = '1.0.0'): string {
  return JSON.stringify({
    ownerId: 'agenshield',
    slug,
    version,
    publishedAt: Date.now(),
  }, null, 2);
}

/**
 * Generate the master SKILL.md entirely in-memory with a dynamic
 * "Currently Connected Integrations" section.
 */
function generateMasterSkillMd(connectedIds: string[]): string {
  const lines: string[] = [
    '---',
    'name: agenco',
    "description: 'Execute third-party integration tools through AgenCo secure cloud gateway'",
    'user-invocable: false',
    'disable-model-invocation: false',
    '',
    'requires:',
    '  bins:',
    '    - agenco',
    '',
    'agenshield:',
    '  policy: builtin-agenco',
    '  required-approval: false',
    '  audit-level: info',
    '  security-level: high',
    '---',
    '',
    '# AgenCo Secure Integrations',
    '',
    'Execute third-party integration tools through the AgenCo secure cloud gateway.',
    'All tool calls are routed through the AgenShield policy engine for audit and enforcement.',
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
  return lines.join('\n');
}

/**
 * Generate a per-integration SKILL.md from INTEGRATION_CATALOG data.
 */
function generateIntegrationSkillMd(integrationId: string): string | null {
  const details = INTEGRATION_CATALOG[integrationId];
  if (!details) return null;

  const lines: string[] = [
    '---',
    `name: agenco-${integrationId}`,
    `description: ${details.description}`,
    'user-invocable: false',
    'disable-model-invocation: false',
    '',
    'requires:',
    '  bins:',
    '    - agenco',
    '',
    'agenshield:',
    `  policy: builtin-agenco-${integrationId}`,
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

// ─── Skill Definition Builders ───────────────────────────────────

/**
 * Build a SkillDefinition for the master agenco skill.
 */
function buildMasterSkillDef(connectedIds: string[], _target: TargetPlatform): SkillDefinition {
  const skillMd = generateMasterSkillMd(connectedIds);

  const files: SourceSkillFile[] = [
    { name: 'SKILL.md', content: skillMd },
    { name: '_meta.json', content: generateMetaJson(MASTER_SKILL_NAME) },
  ];

  return {
    skillId: MASTER_SKILL_NAME,
    name: 'AgenCo Secure Integrations',
    description: 'Execute third-party integration tools through AgenCo secure cloud gateway',
    version: '1.0.0',
    sha: computeSkillDefinitionSha(files),
    platform: _target,
    files,
    trusted: true,
    sourceId: SOURCE_ID,
    tags: ['integrations', 'agenco'],
    author: 'agenshield',
    metadata: {
      createWrapper: true,
      presetPolicies: AGENCO_PRESET.policies,
    },
  };
}

/**
 * Build a SkillDefinition for a per-integration skill.
 */
function buildIntegrationSkillDef(integrationId: string, target: TargetPlatform): SkillDefinition | null {
  const skillMdContent = generateIntegrationSkillMd(integrationId);
  if (!skillMdContent) return null;

  const skillName = `${INTEGRATION_SKILL_PREFIX}${integrationId}`;
  const details = INTEGRATION_CATALOG[integrationId];

  const files: SourceSkillFile[] = [
    { name: 'SKILL.md', content: skillMdContent },
    { name: '_meta.json', content: generateMetaJson(skillName) },
  ];

  return {
    skillId: skillName,
    name: details?.title ?? skillName,
    description: details?.description ?? `AgenCo integration for ${integrationId}`,
    version: '1.0.0',
    sha: computeSkillDefinitionSha(files),
    platform: target,
    files,
    trusted: true,
    sourceId: SOURCE_ID,
    tags: ['integrations', 'agenco', integrationId],
    author: 'agenshield',
  };
}

// ─── Factory ─────────────────────────────────────────────────────

export interface AgenCoConnectionDeps {
  /** Returns the list of currently connected integration IDs */
  getConnectedIntegrations: () => string[];
}

/**
 * Create an MCPConnectionConfig for the AgenCo MCP server.
 */
export function createAgenCoConnection(deps: AgenCoConnectionDeps): MCPConnectionConfig {
  return {
    id: 'agenco',
    displayName: 'AgenCo Integrations',
    trusted: true,

    async getTools(query?: ToolQuery): Promise<DiscoveredTool[]> {
      const connectedIds = deps.getConnectedIntegrations();
      const tools: DiscoveredTool[] = [];

      for (const id of connectedIds) {
        const details = INTEGRATION_CATALOG[id];
        if (!details) continue;

        for (const action of details.actions) {
          const tool: DiscoveredTool = {
            id: `${id}:${action.name}`,
            name: action.name,
            description: action.description,
            sourceId: SOURCE_ID,
            category: id,
          };

          if (query?.search) {
            const q = query.search.toLowerCase();
            if (!tool.name.toLowerCase().includes(q) && !tool.description.toLowerCase().includes(q)) {
              continue;
            }
          }
          tools.push(tool);
        }
      }

      return query?.limit ? tools.slice(0, query.limit) : tools;
    },

    async getSkillsFor(target: TargetPlatform): Promise<SkillDefinition[]> {
      const connectedIds = deps.getConnectedIntegrations();
      const defs: SkillDefinition[] = [];

      if (connectedIds.length === 0) {
        return defs;
      }

      // Master skill
      defs.push(buildMasterSkillDef(connectedIds, target));

      // Per-integration skills
      for (const id of connectedIds) {
        const def = buildIntegrationSkillDef(id, target);
        if (def) defs.push(def);
      }

      return defs;
    },

    async getBins(): Promise<RequiredBinary[]> {
      return [
        {
          name: 'agenco',
          installMethods: [{ type: 'brew', command: 'brew install agenco', package: 'agenco' }],
          managedByShield: true,
        },
        {
          name: 'openclaw',
          installMethods: [{ type: 'brew', command: 'brew install openclaw', package: 'openclaw' }],
          managedByShield: true,
        },
      ];
    },

    async getSkillFiles(skillId: string): Promise<SkillDefinition | null> {
      const connectedIds = deps.getConnectedIntegrations();

      if (skillId === MASTER_SKILL_NAME && connectedIds.length > 0) {
        return buildMasterSkillDef(connectedIds, 'openclaw');
      }

      if (skillId.startsWith(INTEGRATION_SKILL_PREFIX)) {
        const integrationId = skillId.slice(INTEGRATION_SKILL_PREFIX.length);
        if (connectedIds.includes(integrationId)) {
          return buildIntegrationSkillDef(integrationId, 'openclaw');
        }
      }

      return null;
    },

    async getInstructions(): Promise<AdapterInstructions[]> {
      const connectedIds = deps.getConnectedIntegrations();
      if (connectedIds.length === 0) return [];

      return [
        {
          type: 'system',
          content: [
            '## AgenCo Security Policy',
            '',
            'All third-party integration tools are executed through the AgenCo secure cloud gateway.',
            'Never execute integration commands directly — always use the `agenco` skill wrapper.',
            'Integration actions are subject to AgenShield policy enforcement and audit logging.',
          ].join('\n'),
          mode: 'append',
          priority: 50,
        },
      ];
    },

    async isAvailable(): Promise<boolean> {
      return deps.getConnectedIntegrations().length > 0;
    },
  };
}

/**
 * Policy Presets
 *
 * Predefined policy sets that provide sensible defaults for common use cases.
 * Seeded on first config creation.
 */

import type { PolicyConfig } from './types/config';

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  policies: PolicyConfig[];
}

export const OPENCLAW_PRESET: PolicyPreset = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'Default policies for OpenClaw AI coding agent',
  policies: [
    {
      id: 'preset-openclaw-ai-apis',
      name: 'AI Provider APIs',
      action: 'allow',
      target: 'url',
      patterns: [
        'api.openai.com',
        'api.anthropic.com',
        'generativelanguage.googleapis.com',
        'api.mistral.ai',
        'api.cohere.ai',
        'openrouter.ai',
      ],
      enabled: true,
      priority: 5,
      preset: 'openclaw',
    },
    {
      id: 'preset-openclaw-registries',
      name: 'Package Registries & Git',
      action: 'allow',
      target: 'url',
      patterns: [
        'registry.npmjs.org',
        'registry.yarnpkg.com',
        'github.com',
        'api.github.com',
        'pypi.org',
      ],
      enabled: true,
      priority: 5,
      preset: 'openclaw',
    },
    {
      id: 'preset-openclaw-commands',
      name: 'OpenClaw Core Commands',
      action: 'allow',
      target: 'command',
      patterns: [
        'node:*', 'node-bin:*', 'npm:*', 'npx:*', 'openclaw:*',
        'git:*', 'curl:*',
        'ls:*', 'cat:*', 'head:*', 'tail:*',
        'grep:*', 'find:*', 'which:*',
        'echo:*', 'touch:*', 'mkdir:*',
        'cp:*', 'mv:*', 'rm:*',
        'env:*', 'printenv:*',
        'wc:*', 'sort:*', 'uniq:*',
        'sed:*', 'awk:*', 'xargs:*',
        'tar:*', 'tee:*',
        'networksetup:*',
        'arp -a -n -l:*',
        'defaults read:*',
        'sysctl -n hw.model',
        'sw_vers -productVersion',
        '/usr/sbin/scutil --get LocalHostName',
        '/usr/sbin/scutil --get ComputerName',
      ],
      enabled: true,
      priority: 5,
      preset: 'openclaw',
    },
    {
      id: 'preset-openclaw-filesystem',
      name: 'OpenClaw Workspace Access',
      action: 'allow',
      target: 'filesystem',
      patterns: [
        '$WORKSPACE/**',
        '/tmp/**',
      ],
      operations: ['file_read', 'file_write'],
      enabled: true,
      priority: 5,
      preset: 'openclaw',
    },
    {
      id: 'preset-openclaw-channels',
      name: 'Messaging Channels',
      action: 'allow',
      target: 'url',
      patterns: [
        'web.whatsapp.com',
        'api.telegram.org',
        'discord.com',
        'gateway.discord.gg',
        'cdn.discordapp.com',
        'api.slack.com',
        'slack.com',
        'chat.googleapis.com',
        'api.line.me',
      ],
      enabled: true,
      priority: 5,
      preset: 'openclaw',
    },
  ],
};

export const AGENCO_PRESET: PolicyPreset = {
  id: 'agenco',
  name: 'AgenCo Integrations',
  description: 'Policies for AgenCo secure integration skill',
  policies: [
    {
      id: 'preset-agenco-commands',
      name: 'AgenCo Commands',
      action: 'allow',
      target: 'command',
      patterns: ['agenco:*'],
      enabled: true,
      priority: 5,
      preset: 'agenco',
    },
    {
      id: 'preset-agenco-urls',
      name: 'AgenCo Marketplace',
      action: 'allow',
      target: 'url',
      patterns: [
        'mcp.marketplace.frontegg.com',
      ],
      enabled: true,
      priority: 5,
      preset: 'agenco',
    },
  ],
};

export const CLAUDECODE_PRESET: PolicyPreset = {
  id: 'claudecode',
  name: 'Claude Code',
  description: 'Default policies for Anthropic Claude Code agent',
  policies: [
    {
      id: 'preset-cc-ai-apis',
      name: 'AI Provider APIs',
      action: 'allow',
      target: 'url',
      patterns: ['api.anthropic.com', 'api.openai.com'],
      enabled: true,
      priority: 5,
      preset: 'claudecode',
    },
    {
      id: 'preset-cc-registries',
      name: 'Package Registries & Git',
      action: 'allow',
      target: 'url',
      patterns: [
        'registry.npmjs.org',
        'registry.yarnpkg.com',
        'github.com',
        'api.github.com',
        'pypi.org',
      ],
      enabled: true,
      priority: 5,
      preset: 'claudecode',
    },
    {
      id: 'preset-cc-commands',
      name: 'Claude Code Commands',
      action: 'allow',
      target: 'command',
      patterns: [
        'claude:*',
        'node:*',
        'npm:*',
        'npx:*',
        'git:*',
        'python:*',
        'python3:*',
        'pip:*',
        'ls:*',
        'cat:*',
        'head:*',
        'tail:*',
        'grep:*',
        'find:*',
        'which:*',
        'echo:*',
        'touch:*',
        'mkdir:*',
        'cp:*',
        'mv:*',
        'rm:*',
        'wc:*',
        'sort:*',
        'uniq:*',
        'sed:*',
        'awk:*',
        'xargs:*',
      ],
      enabled: true,
      priority: 5,
      preset: 'claudecode',
    },
    {
      id: 'preset-cc-filesystem',
      name: 'Claude Code Workspace Access',
      action: 'allow',
      target: 'filesystem',
      patterns: ['$WORKSPACE/**', '/tmp/**'],
      operations: ['file_read', 'file_write'],
      enabled: true,
      priority: 5,
      preset: 'claudecode',
    },
  ],
};

/** Map from preset ID to preset definition */
export const PRESET_MAP: Record<string, PolicyPreset> = {
  openclaw: OPENCLAW_PRESET,
  agenco: AGENCO_PRESET,
  claudecode: CLAUDECODE_PRESET,
};

/** Get a preset by ID (returns undefined if not found) */
export function getPresetById(id: string): PolicyPreset | undefined {
  return PRESET_MAP[id];
}

export const POLICY_PRESETS: PolicyPreset[] = [OPENCLAW_PRESET, AGENCO_PRESET, CLAUDECODE_PRESET];

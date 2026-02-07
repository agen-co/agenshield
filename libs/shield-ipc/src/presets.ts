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
        'node:*', 'npm:*', 'npx:*',
        'git:*', 'curl:*',
        'ls:*', 'cat:*', 'head:*', 'tail:*',
        'grep:*', 'find:*', 'which:*',
        'echo:*', 'touch:*', 'mkdir:*',
        'cp:*', 'mv:*', 'rm:*',
        'env:*', 'printenv:*',
        'wc:*', 'sort:*', 'uniq:*',
        'sed:*', 'awk:*', 'xargs:*',
        'tar:*', 'tee:*',
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
  ],
};

export const POLICY_PRESETS: PolicyPreset[] = [OPENCLAW_PRESET];

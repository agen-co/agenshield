/**
 * Built-in Security Policies
 *
 * Default policies that ship with AgenShield.
 */

import type { PolicyConfig, PolicyRule } from './enforcer.js';

/**
 * Built-in policy rules
 */
export const BuiltinPolicies: PolicyRule[] = [
  // Allow localhost connections (for broker communication)
  {
    id: 'builtin-allow-localhost',
    name: 'Allow localhost connections',
    type: 'allowlist',
    operations: ['http_request'],
    patterns: [
      'http://localhost:*',
      'http://127.0.0.1:*',
      'https://localhost:*',
      'https://127.0.0.1:*',
    ],
    enabled: true,
    priority: 100,
  },

  // Deny access to sensitive files
  {
    id: 'builtin-deny-secrets',
    name: 'Deny access to secret files',
    type: 'denylist',
    operations: ['file_read', 'file_write'],
    patterns: [
      '**/.env',
      '**/.env.*',
      '**/secrets.json',
      '**/secrets.yaml',
      '**/secrets.yml',
      '**/*.key',
      '**/*.pem',
      '**/*.p12',
      '**/id_rsa',
      '**/id_ed25519',
      '**/.ssh/*',
      '**/credentials.json',
      '**/service-account*.json',
    ],
    enabled: true,
    priority: 200,
  },

  // Deny access to system files
  {
    id: 'builtin-deny-system',
    name: 'Deny access to system files',
    type: 'denylist',
    operations: ['file_read', 'file_write'],
    patterns: [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/etc/ssh/*',
      '/root/**',
      '/var/run/docker.sock',
    ],
    enabled: true,
    priority: 200,
  },

  // Deny dangerous commands
  {
    id: 'builtin-deny-dangerous-commands',
    name: 'Deny dangerous commands',
    type: 'denylist',
    operations: ['exec'],
    patterns: [
      'rm -rf /*',
      'rm -rf /',
      'dd if=*',
      'mkfs.*',
      'chmod -R 777 /*',
      'curl * | sh',
      'curl * | bash',
      'wget * | sh',
      'wget * | bash',
      '* > /dev/sda*',
      'shutdown*',
      'reboot*',
      'init 0',
      'init 6',
    ],
    enabled: true,
    priority: 300,
  },

  // Deny network tools that bypass proxy
  {
    id: 'builtin-deny-network-bypass',
    name: 'Deny direct network tools',
    type: 'denylist',
    operations: ['exec'],
    patterns: [
      'nc *',
      'netcat *',
      'ncat *',
      'socat *',
      'telnet *',
      'nmap *',
      'curl *',  // Should use broker proxy
      'wget *',  // Should use broker proxy
    ],
    enabled: true,
    priority: 150,
  },

  // Allow common AI API endpoints
  {
    id: 'builtin-allow-ai-apis',
    name: 'Allow common AI API endpoints',
    type: 'allowlist',
    operations: ['http_request'],
    patterns: [
      'https://api.anthropic.com/**',
      'https://api.openai.com/**',
      'https://api.cohere.ai/**',
      'https://generativelanguage.googleapis.com/**',
      'https://api.mistral.ai/**',
    ],
    enabled: true,
    priority: 50,
  },

  // Allow common package registries
  {
    id: 'builtin-allow-registries',
    name: 'Allow package registries',
    type: 'allowlist',
    operations: ['http_request'],
    patterns: [
      'https://registry.npmjs.org/**',
      'https://pypi.org/**',
      'https://files.pythonhosted.org/**',
      'https://crates.io/**',
      'https://rubygems.org/**',
    ],
    enabled: true,
    priority: 50,
  },

  // Allow GitHub
  {
    id: 'builtin-allow-github',
    name: 'Allow GitHub',
    type: 'allowlist',
    operations: ['http_request'],
    patterns: [
      'https://github.com/**',
      'https://api.github.com/**',
      'https://raw.githubusercontent.com/**',
      'https://gist.github.com/**',
    ],
    enabled: true,
    priority: 50,
  },
];

/**
 * Get default policy configuration
 */
export function getDefaultPolicies(): PolicyConfig {
  return {
    version: '1.0.0',
    defaultAction: 'deny',
    rules: [...BuiltinPolicies],
    fsConstraints: {
      allowedPaths: [
        '/Users/clawagent/workspace',
        '/tmp/agenshield',
      ],
      deniedPatterns: [
        '**/.env*',
        '**/secrets.*',
        '**/*.key',
        '**/*.pem',
      ],
    },
    networkConstraints: {
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'api.anthropic.com',
        'api.openai.com',
        'registry.npmjs.org',
        'pypi.org',
        'github.com',
        'api.github.com',
      ],
      deniedHosts: ['*'],
      allowedPorts: [80, 443, 6969],
    },
  };
}

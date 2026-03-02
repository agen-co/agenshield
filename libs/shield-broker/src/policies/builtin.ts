/**
 * Built-in Security Policies
 *
 * Default policies that ship with AgenShield.
 */

import os from 'node:os';
import type { PolicyConfig, PolicyRule } from './enforcer.js';
import { SENSITIVE_FILE_PATTERNS } from './sensitive-patterns.js';

/**
 * Built-in policy rules
 */
export const BuiltinPolicies: PolicyRule[] = [
  // Always allow ping (health check for broker availability)
  {
    id: 'builtin-allow-ping',
    name: 'Allow ping health checks',
    action: 'allow',
    target: 'command',
    operations: ['ping'],
    patterns: ['*'],
    enabled: true,
    priority: 1000,
  },

  // Allow interceptor policy checks (internal RPC — must not be subject to policy gate)
  {
    id: 'builtin-allow-policy-check',
    name: 'Allow interceptor policy checks',
    action: 'allow',
    target: 'command',
    operations: ['policy_check'],
    patterns: ['*'],
    enabled: true,
    priority: 1000,
  },

  // Allow interceptor event reporting (internal RPC)
  {
    id: 'builtin-allow-events-batch',
    name: 'Allow interceptor event reporting',
    action: 'allow',
    target: 'command',
    operations: ['events_batch'],
    patterns: ['*'],
    enabled: true,
    priority: 1000,
  },

  // Allow skill installation/uninstallation (daemon management operations)
  {
    id: 'builtin-allow-skill-management',
    name: 'Allow skill management operations',
    action: 'allow',
    target: 'command',
    operations: ['skill_install', 'skill_uninstall'],
    patterns: ['*'],
    enabled: true,
    priority: 1000,
  },

  // Allow localhost connections (for broker communication)
  {
    id: 'builtin-allow-localhost',
    name: 'Allow localhost connections',
    action: 'allow',
    target: 'url',
    operations: ['http_request', 'open_url'],
    patterns: [
      'http://localhost:*',
      'http://localhost:*/**',
      'http://127.0.0.1:*',
      'http://127.0.0.1:*/**',
      'https://localhost:*',
      'https://localhost:*/**',
      'https://127.0.0.1:*',
      'https://127.0.0.1:*/**',
    ],
    enabled: true,
    priority: 100,
  },

  // Deny access to sensitive files (centralized patterns)
  {
    id: 'builtin-deny-secrets',
    name: 'Deny access to secret files',
    action: 'deny',
    target: 'filesystem',
    operations: ['file_read', 'file_write', 'file_list'],
    patterns: [...SENSITIVE_FILE_PATTERNS],
    enabled: true,
    priority: 200,
  },

  // Deny access to system files
  {
    id: 'builtin-deny-system',
    name: 'Deny access to system files',
    action: 'deny',
    target: 'filesystem',
    operations: ['file_read', 'file_write', 'file_list'],
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

  // Allow essential commands for OpenClaw operation (node, openclaw, basic tools).
  // Deny rules below have higher priority and still block dangerous patterns.
  {
    id: 'builtin-allow-essential-exec',
    name: 'Allow essential commands',
    action: 'allow',
    target: 'command',
    operations: ['exec'],
    patterns: [
      'node:*', 'node.real:*', 'node-bin:*', 'npm:*', 'npx:*', 'openclaw:*',
      'git:*', 'curl:*',
      'ls:*', 'cat:*', 'head:*', 'tail:*',
      'grep:*', 'find:*', 'which:*',
      'echo:*', 'touch:*', 'mkdir:*',
      'cp:*', 'mv:*', 'rm:*',
      'env:*', 'printenv:*',
      'wc:*', 'sort:*', 'uniq:*',
      'sed:*', 'awk:*', 'xargs:*',
      'tar:*', 'tee:*',
      'bash:*', 'sh:*', 'zsh:*',
      'chmod:*', 'chown:*',
      'dirname:*', 'basename:*', 'realpath:*',
      'pwd:*', 'whoami:*', 'id:*',
      'python:*', 'python3:*', 'pip:*', 'pip3:*',
      'brew:*',
    ],
    enabled: true,
    priority: 50,
  },

  // Deny dangerous commands
  {
    id: 'builtin-deny-dangerous-commands',
    name: 'Deny dangerous commands',
    action: 'deny',
    target: 'command',
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
    action: 'deny',
    target: 'command',
    operations: ['exec'],
    patterns: [
      'nc *',
      'netcat *',
      'ncat *',
      'socat *',
      'telnet *',
      'nmap *',
    ],
    enabled: true,
    priority: 150,
  },

  // Allow common AI API endpoints
  {
    id: 'builtin-allow-ai-apis',
    name: 'Allow common AI API endpoints',
    action: 'allow',
    target: 'url',
    operations: ['http_request', 'open_url'],
    patterns: [
      'https://api.anthropic.com',
      'https://api.anthropic.com/**',
      'https://api.openai.com',
      'https://api.openai.com/**',
      'https://api.cohere.ai',
      'https://api.cohere.ai/**',
      'https://generativelanguage.googleapis.com',
      'https://generativelanguage.googleapis.com/**',
      'https://api.mistral.ai',
      'https://api.mistral.ai/**',
      'https://claude.ai',
      'https://claude.ai/**',
      'https://platform.claude.com',
      'https://platform.claude.com/**',
      'https://mcp-proxy.anthropic.com',
      'https://mcp-proxy.anthropic.com/**',
      'https://storage.googleapis.com',
      'https://storage.googleapis.com/**',
    ],
    enabled: true,
    priority: 50,
  },

  // Allow common package registries
  {
    id: 'builtin-allow-registries',
    name: 'Allow package registries',
    action: 'allow',
    target: 'url',
    operations: ['http_request', 'open_url'],
    patterns: [
      'https://registry.npmjs.org',
      'https://registry.npmjs.org/**',
      'https://pypi.org',
      'https://pypi.org/**',
      'https://files.pythonhosted.org',
      'https://files.pythonhosted.org/**',
      'https://crates.io',
      'https://crates.io/**',
      'https://rubygems.org',
      'https://rubygems.org/**',
    ],
    enabled: true,
    priority: 50,
  },

  // Allow GitHub
  {
    id: 'builtin-allow-github',
    name: 'Allow GitHub',
    action: 'allow',
    target: 'url',
    operations: ['http_request', 'open_url'],
    patterns: [
      'https://github.com',
      'https://github.com/**',
      'https://api.github.com',
      'https://api.github.com/**',
      'https://raw.githubusercontent.com',
      'https://raw.githubusercontent.com/**',
      'https://gist.github.com',
      'https://gist.github.com/**',
    ],
    enabled: true,
    priority: 50,
  },
];

/**
 * Get default policy configuration
 */
export function getDefaultPolicies(options?: {
  agentHome?: string;
  workspacePaths?: string[];
}): PolicyConfig {
  const agentHome = options?.agentHome
    || process.env['AGENSHIELD_AGENT_HOME']
    || os.homedir();

  const allowedPaths = [
    agentHome,
    '/tmp/agenshield',
    ...(options?.workspacePaths ?? []),
  ];

  return {
    version: '1.0.0',
    defaultAction: 'deny',
    rules: [...BuiltinPolicies],
    fsConstraints: {
      allowedPaths,
      deniedPatterns: [...SENSITIVE_FILE_PATTERNS],
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
        'claude.ai',
        'platform.claude.com',
        'mcp-proxy.anthropic.com',
        'storage.googleapis.com',
      ],
      deniedHosts: ['*'],
      allowedPorts: [80, 443, 5200],
    },
  };
}

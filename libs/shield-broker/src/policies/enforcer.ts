/**
 * Policy Enforcer
 *
 * Evaluates operations against configured policies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HandlerContext } from '../types.js';

/**
 * Policy rule definition
 */
export interface PolicyRule {
  id: string;
  name: string;
  action: 'allow' | 'deny' | 'approval';
  target: 'skill' | 'command' | 'url';
  operations: string[];
  patterns: string[];
  enabled: boolean;
  priority: number;
}

/**
 * Policy check result
 */
export interface PolicyCheckResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

/**
 * Policy configuration
 */
export interface PolicyConfig {
  version: string;
  defaultAction: 'allow' | 'deny';
  rules: PolicyRule[];
  fsConstraints?: {
    allowedPaths: string[];
    deniedPatterns: string[];
  };
  networkConstraints?: {
    allowedHosts: string[];
    deniedHosts: string[];
    allowedPorts: number[];
  };
}

export interface PolicyEnforcerOptions {
  policiesPath: string;
  defaultPolicies: PolicyConfig;
  failOpen: boolean;
}

export class PolicyEnforcer {
  private policies: PolicyConfig;
  private policiesPath: string;
  private failOpen: boolean;
  private lastLoad: number = 0;
  private reloadInterval: number = 60000; // 1 minute

  constructor(options: PolicyEnforcerOptions) {
    this.policiesPath = options.policiesPath;
    this.failOpen = options.failOpen;
    this.policies = options.defaultPolicies;

    this.loadPolicies();
  }

  /**
   * Load policies from disk
   */
  private loadPolicies(): void {
    const configFile = path.join(this.policiesPath, 'default.json');

    if (fs.existsSync(configFile)) {
      try {
        const content = fs.readFileSync(configFile, 'utf-8');
        const loaded = JSON.parse(content) as PolicyConfig;

        // Merge with default policies
        this.policies = {
          ...this.policies,
          ...loaded,
          rules: [...this.policies.rules, ...(loaded.rules || [])],
        };

        this.lastLoad = Date.now();
      } catch (error) {
        console.warn('Warning: Failed to load policies:', error);
      }
    }

    // Load custom policies
    const customDir = path.join(this.policiesPath, 'custom');
    if (fs.existsSync(customDir)) {
      try {
        const files = fs.readdirSync(customDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const content = fs.readFileSync(path.join(customDir, file), 'utf-8');
            const custom = JSON.parse(content) as PolicyConfig;
            if (custom.rules) {
              this.policies.rules.push(...custom.rules);
            }
          }
        }
      } catch (error) {
        console.warn('Warning: Failed to load custom policies:', error);
      }
    }

    // Sort rules by priority (higher first)
    this.policies.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Maybe reload policies if stale
   */
  private maybeReload(): void {
    if (Date.now() - this.lastLoad > this.reloadInterval) {
      this.loadPolicies();
    }
  }

  /**
   * Check if an operation is allowed
   */
  async check(
    operation: string,
    params: Record<string, unknown>,
    context: HandlerContext
  ): Promise<PolicyCheckResult> {
    this.maybeReload();

    try {
      // Extract target from params
      const target = this.extractTarget(operation, params);

      // Check rules in priority order
      for (const rule of this.policies.rules) {
        if (!rule.enabled) continue;
        if (!rule.operations.includes(operation) && !rule.operations.includes('*')) {
          continue;
        }

        const matches = this.matchesPatterns(target, rule.patterns);

        if (matches) {
          if (rule.action === 'deny' || rule.action === 'approval') {
            return {
              allowed: false,
              policyId: rule.id,
              reason: `Denied by policy: ${rule.name}`,
            };
          } else if (rule.action === 'allow') {
            return {
              allowed: true,
              policyId: rule.id,
            };
          }
        }
      }

      // Check constraints
      const constraintResult = this.checkConstraints(operation, params);
      if (!constraintResult.allowed) {
        return constraintResult;
      }

      // Default action
      return {
        allowed: this.policies.defaultAction === 'allow',
        reason:
          this.policies.defaultAction === 'deny'
            ? 'No matching allow policy'
            : undefined,
      };
    } catch (error) {
      console.error('Policy check error:', error);
      return {
        allowed: this.failOpen,
        reason: this.failOpen ? 'Policy check failed, failing open' : 'Policy check failed',
      };
    }
  }

  /**
   * Extract target from operation params
   */
  private extractTarget(operation: string, params: Record<string, unknown>): string {
    switch (operation) {
      case 'http_request':
        return (params['url'] as string) || '';
      case 'file_read':
      case 'file_write':
      case 'file_list':
        return (params['path'] as string) || '';
      case 'exec':
        return `${params['command'] || ''} ${((params['args'] as string[]) || []).join(' ')}`;
      case 'open_url':
        return (params['url'] as string) || '';
      case 'secret_inject':
        return (params['name'] as string) || '';
      default:
        return '';
    }
  }

  /**
   * Check if target matches any patterns
   */
  private matchesPatterns(target: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(target, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a single pattern (supports glob-like matching)
   */
  private matchPattern(target: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(target);
  }

  /**
   * Check operation-specific constraints
   */
  private checkConstraints(
    operation: string,
    params: Record<string, unknown>
  ): PolicyCheckResult {
    // File system constraints
    if (['file_read', 'file_write', 'file_list'].includes(operation)) {
      const filePath = params['path'] as string;
      if (filePath && this.policies.fsConstraints) {
        const { allowedPaths, deniedPatterns } = this.policies.fsConstraints;

        // Check denied patterns first
        for (const pattern of deniedPatterns || []) {
          if (this.matchPattern(filePath, pattern)) {
            return {
              allowed: false,
              reason: `File path matches denied pattern: ${pattern}`,
            };
          }
        }

        // Check allowed paths
        if (allowedPaths && allowedPaths.length > 0) {
          const isAllowed = allowedPaths.some((allowed) =>
            filePath.startsWith(allowed)
          );
          if (!isAllowed) {
            return {
              allowed: false,
              reason: 'File path not in allowed directories',
            };
          }
        }
      }
    }

    // Network constraints
    if (operation === 'http_request') {
      const url = params['url'] as string;
      if (url && this.policies.networkConstraints) {
        try {
          const parsedUrl = new URL(url);
          const host = parsedUrl.hostname;
          const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);

          const { allowedHosts, deniedHosts, allowedPorts } = this.policies.networkConstraints;

          // Check denied hosts
          for (const pattern of deniedHosts || []) {
            if (pattern === '*' || this.matchPattern(host, pattern)) {
              // Check if explicitly allowed
              const isAllowed = (allowedHosts || []).some((allowed) =>
                this.matchPattern(host, allowed)
              );
              if (!isAllowed) {
                return {
                  allowed: false,
                  reason: `Host '${host}' is not allowed`,
                };
              }
            }
          }

          // Check allowed ports
          if (allowedPorts && allowedPorts.length > 0 && !allowedPorts.includes(port)) {
            return {
              allowed: false,
              reason: `Port ${port} is not in allowed ports`,
            };
          }
        } catch {
          return {
            allowed: false,
            reason: 'Invalid URL',
          };
        }
      }
    }

    // Exec constraints
    if (operation === 'exec') {
      const command = (params['command'] as string) || '';
      const args = (params['args'] as string[]) || [];

      // Deny shell metacharacters in command names
      const shellMetachars = /[;&|`$(){}[\]<>!\\]/;
      if (shellMetachars.test(command)) {
        return {
          allowed: false,
          reason: `Shell metacharacters not allowed in command: ${command}`,
        };
      }

      // Deny suspicious path traversal in arguments
      for (const arg of args) {
        if (typeof arg === 'string' && shellMetachars.test(arg) && !arg.startsWith('-')) {
          // Allow shell metacharacters in flag values but deny in bare arguments
          // that look like injection attempts
          if (arg.includes('|') || arg.includes(';') || arg.includes('`') || arg.includes('$(')) {
            return {
              allowed: false,
              reason: `Suspicious argument rejected: ${arg}`,
            };
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Get all configured policies
   */
  getPolicies(): PolicyConfig {
    this.maybeReload();
    return this.policies;
  }

  /**
   * Add a policy rule at runtime
   */
  addRule(rule: PolicyRule): void {
    this.policies.rules.push(rule);
    this.policies.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Remove a policy rule
   */
  removeRule(id: string): boolean {
    const index = this.policies.rules.findIndex((r) => r.id === id);
    if (index >= 0) {
      this.policies.rules.splice(index, 1);
      return true;
    }
    return false;
  }
}

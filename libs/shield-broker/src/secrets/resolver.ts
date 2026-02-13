/**
 * Secret Resolver
 *
 * Receives decrypted secrets from the daemon via IPC push (secrets_sync)
 * and resolves which secrets should be injected as environment variables
 * for each exec operation.
 *
 * - Global secrets (policyIds=[]) are always injected
 * - Policy-linked secrets are injected when the policy's patterns match
 *   the command being executed
 *
 * No disk I/O — secrets live only in memory and are pushed from the daemon
 * over the Unix socket (never HTTP).
 */

interface SecretPolicyBinding {
  policyId: string;
  target: 'url' | 'command';
  patterns: string[];
  secrets: Record<string, string>;
}

interface SyncedSecrets {
  version: string;
  syncedAt: string;
  globalSecrets: Record<string, string>;
  policyBindings: SecretPolicyBinding[];
}

/** Commands that make HTTP requests — URL patterns only matched for these */
const HTTP_COMMANDS = new Set(['curl', 'wget']);

/** curl/wget flags that take a value argument (next arg is the value, not a URL) */
const HTTP_FLAGS_WITH_VALUE = new Set([
  '-X', '--request',
  '-H', '--header',
  '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode',
  '-o', '--output',
  '-u', '--user',
  '-A', '--user-agent',
  '-e', '--referer',
  '-b', '--cookie',
  '-c', '--cookie-jar',
  '--connect-timeout',
  '--max-time',
  '-w', '--write-out',
  '-T', '--upload-file',
  '--resolve',
  '--cacert',
  '--cert',
  '--key',
]);

export class SecretResolver {
  private synced: SyncedSecrets | null = null;

  /**
   * Update the in-memory secrets from a daemon push.
   * Called by the secrets_sync handler over Unix socket.
   */
  updateFromPush(payload: SyncedSecrets): void {
    this.synced = payload;
  }

  /**
   * Clear all in-memory secrets.
   * Called when the daemon locks or shuts down.
   */
  clear(): void {
    this.synced = null;
  }

  /**
   * Get environment variables to inject for an exec operation.
   * Returns global secrets + any secrets from policies whose patterns match.
   */
  getSecretsForExec(command: string, args: string[]): Record<string, string> {
    if (!this.synced) return {};

    const result: Record<string, string> = { ...this.synced.globalSecrets };

    // Match against policy bindings
    for (const binding of this.synced.policyBindings) {
      let matched = false;

      if (binding.target === 'url' && HTTP_COMMANDS.has(command)) {
        const url = this.extractUrlFromArgs(args);
        if (url) {
          matched = binding.patterns.some((p) => this.matchUrlPattern(p, url));
        }
      } else if (binding.target === 'command') {
        const fullCommand = args.length > 0
          ? `${command} ${args.join(' ')}`
          : command;
        matched = binding.patterns.some((p) => this.matchCommandPattern(p, fullCommand));
      }

      if (matched) {
        Object.assign(result, binding.secrets);
      }
    }

    return result;
  }

  /**
   * Get names of secrets that would be injected (for audit logging — names only, never values).
   */
  getSecretNamesForExec(command: string, args: string[]): string[] {
    return Object.keys(this.getSecretsForExec(command, args));
  }

  // --- URL matching (replicated from daemon rpc.ts) ---

  private normalizeUrlBase(pattern: string): string {
    let p = pattern.trim();
    p = p.replace(/\/+$/, '');
    if (!p.match(/^(\*|https?):\/\//i)) {
      p = `https://${p}`;
    }
    return p;
  }

  private normalizeUrlTarget(url: string): string {
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      let urlPath = parsed.pathname;
      if (urlPath.length > 1) {
        urlPath = urlPath.replace(/\/+$/, '');
      }
      return `${parsed.protocol}//${parsed.host}${urlPath}${parsed.search}`;
    } catch {
      return trimmed.replace(/\/+$/, '');
    }
  }

  private globToRegex(pattern: string): RegExp {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
  }

  private matchUrlPattern(pattern: string, target: string): boolean {
    const base = this.normalizeUrlBase(pattern);
    const trimmed = pattern.trim().replace(/\/+$/, '');
    const effectiveTarget = this.normalizeUrlTarget(target);

    if (trimmed.endsWith('*')) {
      return this.globToRegex(base).test(effectiveTarget);
    }
    return (
      this.globToRegex(base).test(effectiveTarget) ||
      this.globToRegex(`${base}/**`).test(effectiveTarget)
    );
  }

  // --- Command matching (replicated from daemon rpc.ts) ---

  private matchCommandPattern(pattern: string, target: string): boolean {
    const trimmed = pattern.trim();
    if (trimmed === '*') return true;
    if (trimmed.endsWith(':*')) {
      const prefix = trimmed.slice(0, -2);
      const lowerTarget = target.toLowerCase();
      const lowerPrefix = prefix.toLowerCase();
      return lowerTarget === lowerPrefix || lowerTarget.startsWith(lowerPrefix + ' ');
    }
    return target.toLowerCase() === trimmed.toLowerCase();
  }

  // --- URL extraction from curl/wget args ---

  private extractUrlFromArgs(args: string[]): string | null {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('-')) {
        if (HTTP_FLAGS_WITH_VALUE.has(arg)) {
          i++; // skip the value
        }
        continue;
      }
      return arg;
    }
    return null;
  }
}

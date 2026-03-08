/**
 * macOS Keychain KeyProvider
 *
 * Communicates with the Swift KeychainHelper binary via JSON stdin/stdout.
 * Falls back to NoopKeyProvider if the helper binary is not found.
 *
 * When running as root, all keychain operations are delegated to the host
 * user's keychain via `sudo -u <hostUsername>`. This ensures a single
 * keychain (the host user's) is used for all credential storage.
 *
 * Protocol:
 *   stdin  → { "command": "set"|"get"|"delete"|"has", "account": "...", ... }
 *   stdout → { "success": true|false, "data": "base64...", "error": "..." }
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KeyProvider, KeychainAccessibility } from './types';
import { KeychainError, KeychainAccessDeniedError } from './errors';
import { resolveHostUser } from './host-user';

/** Default service name for Keychain items */
const DEFAULT_SERVICE = 'com.frontegg.AgenShield';

/** Known locations to find the KeychainHelper binary */
function findHelperBinary(hostHome?: string): string | null {
  const home = hostHome ?? os.homedir();
  const searchPaths = [
    // Built from Xcode project
    path.join(home, '.agenshield', 'bin', 'agenshield-keychain'),
    // Alongside the CLI binary
    path.join(path.dirname(process.execPath), '..', 'libexec', 'agenshield-keychain'),
    path.join(path.dirname(process.execPath), 'agenshield-keychain'),
    // Development: built by swiftc in the project
    path.join(process.cwd(), 'apps', 'shield-macos', 'build', 'KeychainHelper'),
  ];

  for (const p of searchPaths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

interface HelperResponse {
  success: boolean;
  data?: string; // base64 encoded
  error?: string;
  errorCode?: string;
}

export class MacOSKeyProvider implements KeyProvider {
  readonly isKeychainBacked = true;
  private readonly helperPath: string;
  private readonly service: string;
  private readonly hostUsername: string | null;

  constructor(helperPath: string, service = DEFAULT_SERVICE, hostUsername?: string) {
    this.helperPath = helperPath;
    this.service = service;
    this.hostUsername = hostUsername ?? null;
  }

  async set(
    account: string,
    data: Buffer | string,
    options?: {
      accessible?: KeychainAccessibility;
      synchronizable?: boolean;
      label?: string;
    },
  ): Promise<boolean> {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const request = {
      command: 'set',
      service: this.service,
      account,
      data: dataBuffer.toString('base64'),
      accessible: options?.accessible ?? 'WhenUnlockedThisDeviceOnly',
      synchronizable: options?.synchronizable ?? false,
      label: options?.label,
    };

    const response = this.callHelper(request);
    return response.success;
  }

  async get(account: string): Promise<Buffer | null> {
    const request = {
      command: 'get',
      service: this.service,
      account,
    };

    const response = this.callHelper(request);
    if (!response.success || !response.data) {
      return null;
    }
    return Buffer.from(response.data, 'base64');
  }

  async delete(account: string): Promise<boolean> {
    const request = {
      command: 'delete',
      service: this.service,
      account,
    };

    const response = this.callHelper(request);
    return response.success;
  }

  async has(account: string): Promise<boolean> {
    const request = {
      command: 'has',
      service: this.service,
      account,
    };

    const response = this.callHelper(request);
    return response.success;
  }

  private callHelper(request: Record<string, unknown>): HelperResponse {
    try {
      const input = JSON.stringify(request);
      let output: string;

      // When running as root, delegate to host user's keychain
      const needsSudo = process.getuid?.() === 0 && this.hostUsername;
      if (needsSudo) {
        output = execFileSync('sudo', ['-u', this.hostUsername!, this.helperPath], {
          input,
          encoding: 'utf-8',
          timeout: 10_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        output = execFileSync(this.helperPath, [], {
          input,
          encoding: 'utf-8',
          timeout: 10_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      return JSON.parse(output.trim()) as HelperResponse;
    } catch (err) {
      const message = (err as Error).message || 'Unknown error';
      if (message.includes('errSecAuthFailed') || message.includes('errSecUserCanceled')) {
        throw new KeychainAccessDeniedError(request['account'] as string, message);
      }
      throw new KeychainError(`Keychain helper failed: ${message}`, 'HELPER_FAILED');
    }
  }

  /**
   * Try to create a MacOSKeyProvider, returning null if the helper binary is not found.
   *
   * Resolves the host user automatically so that keychain operations always
   * target the host user's keychain, even when running as root.
   */
  static tryCreate(service?: string): MacOSKeyProvider | null {
    const { username, home } = resolveHostUser();
    const helperPath = findHelperBinary(home);
    if (!helperPath) return null;
    return new MacOSKeyProvider(helperPath, service, username);
  }
}

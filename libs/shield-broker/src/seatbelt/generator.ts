/**
 * Seatbelt Profile Generator
 *
 * Generates macOS Seatbelt (sandbox-exec) profiles.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SeatbeltTemplates } from './templates.js';

export interface SeatbeltOptions {
  workspacePath: string;
  socketPath: string;
  allowedBinPaths: string[];
  allowedReadPaths: string[];
  additionalRules?: string[];
}

export interface OperationSeatbeltOptions {
  operation: string;
  targetPath?: string;
  targetHost?: string;
  targetPort?: number;
}

export class SeatbeltGenerator {
  private templates: SeatbeltTemplates;

  constructor() {
    this.templates = new SeatbeltTemplates();
  }

  /**
   * Generate the main agent seatbelt profile
   */
  generateAgentProfile(options: SeatbeltOptions): string {
    const {
      workspacePath,
      socketPath,
      allowedBinPaths,
      allowedReadPaths,
      additionalRules = [],
    } = options;

    const profile = `
;; AgenShield Agent Sandbox Profile
;; Generated at: ${new Date().toISOString()}
(version 1)
(deny default)

;; ========================================
;; System Libraries & Frameworks
;; ========================================
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/Library/Frameworks")
  (subpath "/Library/Preferences")
  (subpath "/private/var/db"))

;; ========================================
;; Node.js / Python Runtimes
;; ========================================
(allow file-read*
  (subpath "/usr/local/lib/node_modules")
  (subpath "/opt/homebrew/lib/node_modules")
  (subpath "/usr/local/Cellar")
  (subpath "/opt/homebrew/Cellar")
  (subpath "/Library/Frameworks/Python.framework"))

;; ========================================
;; Workspace Access (Read/Write)
;; ========================================
(allow file-read* file-write*
  (subpath "${workspacePath}"))

;; ========================================
;; Additional Read-Only Paths
;; ========================================
${allowedReadPaths.map((p) => `(allow file-read* (subpath "${p}"))`).join('\n')}

;; ========================================
;; Binary Execution
;; ========================================
(allow process-exec
  (literal "/bin/sh")
  (literal "/bin/bash")
  (literal "/usr/bin/env")
  ${allowedBinPaths.map((p) => `(subpath "${p}")`).join('\n  ')})

;; ========================================
;; Unix Socket Access (Broker)
;; ========================================
(allow network-outbound
  (local unix-socket "${socketPath}"))

;; ========================================
;; Network Denial (CRITICAL)
;; ========================================
(deny network*)

;; ========================================
;; Process & Signal Handling
;; ========================================
(allow process-fork)
(allow signal (target self))

;; ========================================
;; Mach IPC (Limited)
;; ========================================
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.CoreServices.coreservicesd"))

;; ========================================
;; Sysctl (Limited)
;; ========================================
(allow sysctl-read)

;; ========================================
;; Additional Rules
;; ========================================
${additionalRules.join('\n')}
`;

    return profile.trim();
  }

  /**
   * Generate a per-operation seatbelt profile
   */
  generateOperationProfile(options: OperationSeatbeltOptions): string {
    const { operation, targetPath, targetHost, targetPort } = options;

    switch (operation) {
      case 'file_read':
        return this.templates.fileReadProfile(targetPath || '/');

      case 'file_write':
        return this.templates.fileWriteProfile(targetPath || '/');

      case 'http_request':
        return this.templates.httpRequestProfile(targetHost, targetPort);

      case 'exec':
        return this.templates.execProfile(targetPath);

      default:
        return this.templates.baseProfile();
    }
  }

  /**
   * Install seatbelt profiles to disk
   */
  async installProfiles(
    outputDir: string,
    options: SeatbeltOptions
  ): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Generate and write main agent profile
    const agentProfile = this.generateAgentProfile(options);
    await fs.writeFile(
      path.join(outputDir, 'agent.sb'),
      agentProfile,
      { mode: 0o644 }
    );

    // Create ops directory
    const opsDir = path.join(outputDir, 'ops');
    await fs.mkdir(opsDir, { recursive: true });

    // Generate per-operation profiles
    const operations = ['file_read', 'file_write', 'http_request', 'exec'];
    for (const op of operations) {
      const profile = this.generateOperationProfile({ operation: op });
      await fs.writeFile(
        path.join(opsDir, `${op}.sb`),
        profile,
        { mode: 0o644 }
      );
    }
  }

  /**
   * Verify a seatbelt profile is valid
   */
  async verifyProfile(profilePath: string): Promise<boolean> {
    // sandbox-exec doesn't have a dry-run mode, so we just check syntax
    try {
      const content = await fs.readFile(profilePath, 'utf-8');

      // Basic syntax checks
      if (!content.includes('(version 1)')) {
        return false;
      }

      // Check for balanced parentheses
      let depth = 0;
      for (const char of content) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (depth < 0) return false;
      }

      return depth === 0;
    } catch {
      return false;
    }
  }
}

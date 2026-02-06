/**
 * Seatbelt Profile Management
 *
 * Generates and installs macOS sandbox profiles.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const SEATBELT_DIR = '/etc/agenshield/seatbelt';

/**
 * Agent seatbelt profile template
 */
export function generateAgentProfile(options: {
  workspacePath: string;
  socketPath: string;
  agentHome?: string;
  additionalReadPaths?: string[];
}): string {
  const additionalReads = (options.additionalReadPaths || [])
    .map((p) => `(allow file-read* (subpath "${p}"))`)
    .join('\n');

  return `;;
;; AgenShield Agent Sandbox Profile
;; Generated at: ${new Date().toISOString()}
;;
;; HYBRID SECURITY MODEL:
;; - Seatbelt: Static deny rules for dangerous system paths (kernel-enforced)
;; - ACLs: Dynamic allow rules for fine-grained runtime control
;;

(version 1)
(deny default)

;; ========================================
;; CRITICAL DENIALS - Dangerous System Paths
;; (kernel-enforced, cannot be bypassed at runtime)
;; ========================================
;; System binaries - prevent reading/execution of system commands
(deny file-read*
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/sbin")
  (subpath "/bin"))

;; Sensitive system configuration
(deny file-read*
  (subpath "/etc")
  (subpath "/private/etc/sudoers")
  (subpath "/private/etc/sudoers.d")
  (subpath "/private/etc/ssh")
  (subpath "/private/etc/pam.d"))

;; System logs - prevent information disclosure
(deny file-read*
  (subpath "/var/log")
  (subpath "/private/var/log")
  (subpath "/Library/Logs"))

;; Root and admin directories
(deny file-read*
  (subpath "/private/var/root")
  (subpath "/Library/Admin"))

;; ========================================
;; CRITICAL DENIALS - Prevent agent from modifying
;; its own bin directory, skills, or system config
;; ========================================
${options.agentHome ? `(deny file-write* (subpath "${options.agentHome}/bin"))
(deny file-write* (subpath "${options.agentHome}/.openclaw"))` : ''}
(deny file-write* (subpath "/opt/agenshield"))
(deny file-write* (subpath "/etc/agenshield"))

;; ========================================
;; System Libraries & Frameworks (Read-only)
;; Required for process execution
;; ========================================
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/Library/Frameworks")
  (subpath "/Library/Preferences")
  (subpath "/private/var/db"))

;; ========================================
;; Runtime Dependencies
;; ========================================
(allow file-read*
  (subpath "/usr/local/lib/node_modules")
  (subpath "/opt/homebrew/lib/node_modules")
  (subpath "/usr/local/Cellar")
  (subpath "/opt/homebrew/Cellar")
  (subpath "/usr/local/bin")
  (subpath "/opt/homebrew/bin")
  (subpath "/Library/Frameworks/Python.framework"))

;; ========================================
;; BROAD USER FILESYSTEM ACCESS
;; (ACLs will handle fine-grained runtime control)
;; ========================================
(allow file-read*
  (subpath "/Users")
  (subpath "/Volumes")
  (subpath "/android")
  (subpath "/opt"))

;; ========================================
;; Workspace (Read/Write)
;; ========================================
(allow file-read* file-write*
  (subpath "${options.workspacePath}"))

;; Temp directories (Read/Write)
(allow file-read* file-write*
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/var/folders"))

;; ========================================
;; Additional Read Paths
;; ========================================
${additionalReads}

;; ========================================
;; Binary Execution
;; ========================================
(allow process-exec
  (literal "/bin/sh")
  (literal "/bin/bash")
  (literal "/usr/bin/env")
  ${options.agentHome ? `(subpath "${options.agentHome}/bin")` : ''}
  (subpath "/opt/agenshield/bin")
  (subpath "/usr/local/bin")
  (subpath "/opt/homebrew/bin"))

;; ========================================
;; Unix Socket (Broker Communication)
;; ========================================
(allow network-outbound
  (local unix-socket "${options.socketPath}"))

;; ========================================
;; Network DENIAL (Critical)
;; ========================================
(deny network*)

;; ========================================
;; Process & Signal
;; ========================================
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)

;; ========================================
;; Mach IPC (Limited)
;; ========================================
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.CoreServices.coreservicesd")
  (global-name "com.apple.SecurityServer"))

;; ========================================
;; User Defaults
;; ========================================
(allow user-preference-read)
`;
}

/**
 * Per-operation profile template
 */
export function generateOperationProfile(
  operation: string,
  target?: string
): string {
  switch (operation) {
    case 'file_read':
      return generateFileReadProfile(target);
    case 'file_write':
      return generateFileWriteProfile(target);
    case 'http_request':
      return generateHttpProfile(target);
    case 'exec':
      return generateExecProfile(target);
    default:
      return generateMinimalProfile();
  }
}

function generateMinimalProfile(): string {
  return `(version 1)
(deny default)
(allow file-read* (subpath "/System") (subpath "/usr/lib"))
(allow sysctl-read)
`;
}

function generateFileReadProfile(targetPath?: string): string {
  return `(version 1)
(deny default)
(allow file-read* (subpath "/System") (subpath "/usr/lib"))
${targetPath ? `(allow file-read* (subpath "${targetPath}"))` : ''}
(deny network*)
(allow sysctl-read)
`;
}

function generateFileWriteProfile(targetPath?: string): string {
  return `(version 1)
(deny default)
(allow file-read* (subpath "/System") (subpath "/usr/lib"))
${targetPath ? `(allow file-read* file-write* (subpath "${targetPath}"))` : ''}
(deny network*)
(allow sysctl-read)
`;
}

function generateHttpProfile(targetHost?: string): string {
  return `(version 1)
(deny default)
(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/private/var/db"))
(allow network-outbound ${targetHost ? `(remote tcp "${targetHost}")` : ''})
(allow network-outbound (remote udp "*:53") (remote tcp "*:53"))
(allow sysctl-read)
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.networkd"))
`;
}

function generateExecProfile(binaryPath?: string): string {
  return `(version 1)
(deny default)
;; System libraries for execution
(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share"))
;; Homebrew and local binaries (not system /bin, /usr/bin)
(allow file-read* (subpath "/usr/local/bin") (subpath "/opt/homebrew/bin"))
(allow process-exec (literal "/bin/sh") (literal "/bin/bash") (literal "/usr/bin/env"))
(allow process-exec (subpath "/usr/local/bin") (subpath "/opt/homebrew/bin"))
${binaryPath ? `(allow process-exec (literal "${binaryPath}"))` : ''}
(deny network*)
(allow process-fork)
(allow signal)
(allow sysctl-read)
`;
}

export interface ProfileResult {
  success: boolean;
  path: string;
  message: string;
  error?: Error;
}

/**
 * Install seatbelt profiles
 */
export async function installProfiles(options: {
  workspacePath: string;
  socketPath: string;
}): Promise<ProfileResult[]> {
  const results: ProfileResult[] = [];

  try {
    // Ensure directory exists
    await fs.mkdir(SEATBELT_DIR, { recursive: true });
    await fs.mkdir(path.join(SEATBELT_DIR, 'ops'), { recursive: true });
  } catch {
    // Directories might exist
  }

  // Install main agent profile
  const agentProfile = generateAgentProfile(options);
  const agentPath = path.join(SEATBELT_DIR, 'agent.sb');

  try {
    await fs.writeFile(agentPath, agentProfile, { mode: 0o644 });
    results.push({
      success: true,
      path: agentPath,
      message: 'Installed agent.sb',
    });
  } catch (error) {
    results.push({
      success: false,
      path: agentPath,
      message: `Failed to install agent.sb: ${(error as Error).message}`,
      error: error as Error,
    });
  }

  // Install per-operation profiles
  const operations = ['file_read', 'file_write', 'http_request', 'exec'];
  for (const op of operations) {
    const profile = generateOperationProfile(op);
    const profilePath = path.join(SEATBELT_DIR, 'ops', `${op}.sb`);

    try {
      await fs.writeFile(profilePath, profile, { mode: 0o644 });
      results.push({
        success: true,
        path: profilePath,
        message: `Installed ${op}.sb`,
      });
    } catch (error) {
      results.push({
        success: false,
        path: profilePath,
        message: `Failed to install ${op}.sb: ${(error as Error).message}`,
        error: error as Error,
      });
    }
  }

  return results;
}

/**
 * Verify seatbelt profile syntax
 */
export async function verifyProfile(profilePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(profilePath, 'utf-8');

    // Basic syntax checks
    if (!content.includes('(version 1)')) {
      return false;
    }

    // Check balanced parentheses
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

/**
 * Install seatbelt profiles using UserConfig
 *
 * @param config - UserConfig with user/group information
 * @param profiles - Generated profiles to install
 */
export async function installSeatbeltProfiles(
  config: import('@agenshield/ipc').UserConfig,
  profiles: { agentProfile: string }
): Promise<{
  success: boolean;
  error?: string;
  agentProfilePath?: string;
  operationProfilePaths?: string[];
}> {
  const seatbeltDir = '/etc/agenshield/seatbelt';
  const opsDir = `${seatbeltDir}/ops`;

  try {
    // Ensure directories exist
    await execAsync(`sudo mkdir -p "${seatbeltDir}"`);
    await execAsync(`sudo mkdir -p "${opsDir}"`);

    // Write agent profile
    const agentProfilePath = `${seatbeltDir}/agent.sb`;
    await execAsync(`sudo tee "${agentProfilePath}" > /dev/null << 'EOF'
${profiles.agentProfile}
EOF`);
    await execAsync(`sudo chmod 644 "${agentProfilePath}"`);

    // Write per-operation profiles
    const operationProfilePaths: string[] = [];
    const operations = ['file_read', 'file_write', 'http_request', 'exec'];

    for (const op of operations) {
      const profile = generateOperationProfile(op);
      const profilePath = `${opsDir}/${op}.sb`;
      await execAsync(`sudo tee "${profilePath}" > /dev/null << 'EOF'
${profile}
EOF`);
      await execAsync(`sudo chmod 644 "${profilePath}"`);
      operationProfilePaths.push(profilePath);
    }

    return {
      success: true,
      agentProfilePath,
      operationProfilePaths,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Generate agent profile from UserConfig
 */
export function generateAgentProfileFromConfig(config: import('@agenshield/ipc').UserConfig): string {
  return generateAgentProfile({
    workspacePath: `${config.agentUser.home}/workspace`,
    socketPath: '/var/run/agenshield/agenshield.sock',
    agentHome: config.agentUser.home,
  });
}

// Alias for engine compatibility
export { generateAgentProfileFromConfig as generateAgentProfile_v2 };

/**
 * Get installed profiles
 */
export async function getInstalledProfiles(): Promise<string[]> {
  const profiles: string[] = [];

  try {
    const mainFiles = await fs.readdir(SEATBELT_DIR);
    for (const file of mainFiles) {
      if (file.endsWith('.sb')) {
        profiles.push(path.join(SEATBELT_DIR, file));
      }
    }

    const opsDir = path.join(SEATBELT_DIR, 'ops');
    const opsFiles = await fs.readdir(opsDir);
    for (const file of opsFiles) {
      if (file.endsWith('.sb')) {
        profiles.push(path.join(opsDir, file));
      }
    }
  } catch {
    // Directories might not exist
  }

  return profiles;
}

/**
 * Skill Injector
 *
 * Injects security-related skills into OpenClaw's skills directory
 * when AgenShield is set up. This ensures critical security skills
 * are always available to the sandboxed agent.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { UserConfig } from '@agenshield/ipc';

export interface SkillInjectionResult {
  success: boolean;
  skillsDir: string;
  injectedSkills: string[];
  error?: string;
}

/**
 * Get the OpenClaw skills directory for a user
 */
export function getSkillsDir(homeDir: string): string {
  // OpenClaw stores skills in ~/.openclaw/skills/ or ~/.config/openclaw/skills/
  const possiblePaths = [
    path.join(homeDir, '.openclaw', 'skills'),
    path.join(homeDir, '.config', 'openclaw', 'skills'),
  ];

  // Check which path exists, or use the first as default
  for (const p of possiblePaths) {
    if (fs.existsSync(path.dirname(p))) {
      return p;
    }
  }

  return possiblePaths[0];
}

/**
 * Get the path to the bundled AgenCo skill
 */
export function getAgenCoSkillPath(): string {
  // The skill is bundled with the agenshield package
  // Look for it relative to this module's location
  const possiblePaths = [
    // Development: built-in skill in shield-skills
    path.resolve(__dirname, '../../..', 'libs/shield-skills/skills/agenco-secure-integrations'),
    // Installed: in node_modules
    path.resolve(__dirname, '..', 'agenco-secure-integrations'),
    // Global install
    '/opt/agenshield/skills/agenco-secure-integrations',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'SKILL.md'))) {
      return p;
    }
  }

  throw new Error('AgenCo skill not found. Please reinstall AgenShield.');
}

/**
 * Copy a directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and dist directories
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Inject the AgenCo skill into OpenClaw's skills directory
 */
export async function injectAgenCoSkill(
  config: UserConfig
): Promise<SkillInjectionResult> {
  const homeDir = config.agentUser.home;
  const skillsDir = getSkillsDir(homeDir);
  const injectedSkills: string[] = [];

  try {
    // Get the source skill path
    const sourcePath = getAgenCoSkillPath();

    // Create skills directory if it doesn't exist
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true, mode: 0o755 });
    }

    // Copy the skill
    const destPath = path.join(skillsDir, 'agenco-secure-integrations');
    copyDirRecursive(sourcePath, destPath);

    // Build the skill if needed (has package.json but no dist)
    const packageJson = path.join(destPath, 'package.json');
    const distDir = path.join(destPath, 'dist');
    if (fs.existsSync(packageJson) && !fs.existsSync(distDir)) {
      console.log('Building AgenCo skill...');
      execSync('npm install && npm run build', {
        cwd: destPath,
        stdio: 'inherit',
      });
    }

    // Make the bin script executable
    const binPath = path.join(destPath, 'bin', 'agenco.js');
    if (fs.existsSync(binPath)) {
      fs.chmodSync(binPath, 0o755);
    }

    // Set ownership to root with socket group (agent gets read+exec only)
    const socketGroupName = config.groups.socket.name;
    try {
      execSync(`sudo chown -R root:${socketGroupName} "${skillsDir}"`, { stdio: 'pipe' });
      execSync(`sudo chmod -R a+rX,go-w "${skillsDir}"`, { stdio: 'pipe' });
    } catch {
      // May fail if not root, but that's okay for development
    }

    injectedSkills.push('agenco-secure-integrations');

    return {
      success: true,
      skillsDir,
      injectedSkills,
    };
  } catch (err) {
    return {
      success: false,
      skillsDir,
      injectedSkills,
      error: (err as Error).message,
    };
  }
}

/**
 * Create a symlink for the agenco command in the agent's bin directory
 */
export async function createAgenCoSymlink(
  config: UserConfig,
  binDir: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const skillsDir = getSkillsDir(config.agentUser.home);
    const agencoBin = path.join(
      skillsDir,
      'agenco-secure-integrations',
      'bin',
      'agenco.js'
    );

    const symlinkPath = path.join(binDir, 'agenco');

    // Remove existing symlink if present
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }

    // Create symlink
    fs.symlinkSync(agencoBin, symlinkPath);

    // Make executable
    fs.chmodSync(symlinkPath, 0o755);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Remove injected skills (for uninstall)
 */
export async function removeInjectedSkills(
  homeDir: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const skillsDir = getSkillsDir(homeDir);
    const agencoPath = path.join(skillsDir, 'agenco-secure-integrations');

    if (fs.existsSync(agencoPath)) {
      fs.rmSync(agencoPath, { recursive: true, force: true });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Update OpenClaw's MCP configuration to include AgenCo
 */
export async function updateOpenClawMcpConfig(
  homeDir: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const configPaths = [
      path.join(homeDir, '.openclaw', 'mcp.json'),
      path.join(homeDir, '.config', 'openclaw', 'mcp.json'),
    ];

    // Find or create config
    let configPath = configPaths[0];
    for (const p of configPaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }

    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
    }

    // Load existing config or create new
    let config: { mcpServers?: Record<string, unknown> } = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add AgenCo server
    config.mcpServers['agenco-marketplace'] = {
      url: 'https://mcp.marketplace.frontegg.com/mcp',
      transport: 'sse',
      auth: {
        type: 'oauth',
        tokenProvider: 'agenco-secure-integrations',
      },
      metadata: {
        name: 'AgenCo Marketplace',
        description: 'Secure third-party integrations via AgenCo cloud vault',
        categories: ['integrations', 'productivity', 'security'],
      },
    };

    // Write config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o644 });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Wrapper Scripts Installation
 *
 * Installs command wrappers that route operations through the broker.
 * Supports dynamic wrapper management based on policy configuration.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { UserConfig } from '@agenshield/ipc';

// Create a require function for ESM compatibility (needed for require.resolve)
const require = createRequire(import.meta.url);

const execAsync = promisify(exec);

/**
 * Wrapper definition interface
 */
export interface WrapperDefinition {
  description: string;
  /** Whether this wrapper requires seatbelt profile */
  usesSeatbelt?: boolean;
  /** Whether this wrapper uses Node.js interceptor */
  usesInterceptor?: boolean;
  /** The content generator function */
  generate: (config: WrapperConfig) => string;
}

/**
 * Configuration for wrapper generation
 */
export interface WrapperConfig {
  /** Agent home directory */
  agentHome: string;
  /** Agent username */
  agentUsername: string;
  /** Socket path */
  socketPath: string;
  /** HTTP fallback port */
  httpPort: number;
  /** Path to interceptor module */
  interceptorPath: string;
  /** NODE_OPTIONS flag: '--require' for CJS or '--import' for ESM */
  interceptorFlag: string;
  /** Path to seatbelt profiles */
  seatbeltDir: string;
  /** Path to Python executable */
  pythonPath: string;
  /** Path to Node.js executable */
  nodePath: string;
  /** Path to npm executable */
  npmPath: string;
  /** Path to brew executable */
  brewPath: string;
}

/**
 * Default wrapper configuration
 */
export function getDefaultWrapperConfig(userConfig?: UserConfig): WrapperConfig {
  const agentHome = userConfig?.agentUser.home || '/Users/agenshield_agent';
  return {
    agentHome,
    agentUsername: userConfig?.agentUser.username || 'agenshield_agent',
    socketPath: '/var/run/agenshield/agenshield.sock',
    httpPort: 5201, // Broker uses 5201, daemon uses 5200
    interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
    interceptorFlag: '--require',
    seatbeltDir: '/etc/agenshield/seatbelt',
    pythonPath: '/usr/bin/python3',
    nodePath: '/usr/local/bin/node',
    npmPath: '/usr/local/bin/npm',
    brewPath: '/opt/homebrew/bin/brew',
  };
}

/**
 * Wrapper definitions with dynamic content generation
 */
export const WRAPPER_DEFINITIONS: Record<string, WrapperDefinition> = {
  shieldctl: {
    description: 'AgenShield control CLI',
    generate: (config) => `#!/bin/bash
# AgenShield Control CLI Wrapper
# Routes commands through the broker

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"
HTTP_HOST="\${AGENSHIELD_HTTP_HOST:-localhost}"
HTTP_PORT="\${AGENSHIELD_HTTP_PORT:-${config.httpPort}}"

exec /opt/agenshield/bin/shield-client "$@"
`,
  },

  curl: {
    description: 'curl wrapper that routes through broker',
    generate: (config) => `#!/bin/bash
# curl wrapper - routes HTTP requests through AgenShield broker
# Usage: curl [options] <url>

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"

# Extract URL from arguments
URL=""
METHOD="GET"
HEADERS=""
DATA=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -X|--request)
      METHOD="$2"
      shift 2
      ;;
    -H|--header)
      HEADERS="$HEADERS -H '$2'"
      shift 2
      ;;
    -d|--data)
      DATA="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      URL="$1"
      shift
      ;;
  esac
done

if [ -z "$URL" ]; then
  echo "Usage: curl [options] <url>" >&2
  exit 1
fi

# Route through broker
exec /opt/agenshield/bin/shield-client http "$METHOD" "$URL" $DATA
`,
  },

  wget: {
    description: 'wget wrapper that routes through broker',
    generate: (config) => `#!/bin/bash
# wget wrapper - routes HTTP requests through AgenShield broker

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

URL="$1"

if [ -z "$URL" ]; then
  echo "Usage: wget <url>" >&2
  exit 1
fi

exec /opt/agenshield/bin/shield-client http GET "$URL"
`,
  },

  git: {
    description: 'git wrapper with network routing',
    generate: (config) => `#!/bin/bash
# git wrapper - routes git network operations through broker
# Network operations (clone, fetch, push, pull) are monitored

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"

# Check if this is a network operation
case "$1" in
  clone|fetch|push|pull|ls-remote)
    # Route through broker for network ops
    exec /opt/agenshield/bin/shield-client git "$@"
    ;;
  *)
    # Local operations pass through directly
    exec /usr/bin/git "$@"
    ;;
esac
`,
  },

  npm: {
    description: 'npm wrapper with Node.js interceptor',
    usesInterceptor: true,
    generate: (config) => `#!/bin/bash
# npm wrapper - routes npm network requests through AgenShield interceptor
# Uses NODE_OPTIONS to load the interceptor module

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

# Set up interceptor
export NODE_OPTIONS="${config.interceptorFlag} ${config.interceptorPath} \${NODE_OPTIONS:-}"

# Set AgenShield environment
export AGENSHIELD_SOCKET="${config.socketPath}"
export AGENSHIELD_HTTP_PORT="${config.httpPort}"
export AGENSHIELD_INTERCEPT_FETCH=true
export AGENSHIELD_INTERCEPT_HTTP=true

# Set execution context
export AGENSHIELD_CONTEXT_TYPE=\${AGENSHIELD_CONTEXT_TYPE:-agent}

# Find npm - prefer homebrew, then system
if [ -x "/opt/homebrew/bin/npm" ]; then
  exec /opt/homebrew/bin/npm "$@"
elif [ -x "${config.npmPath}" ]; then
  exec ${config.npmPath} "$@"
else
  echo "npm not found" >&2
  exit 1
fi
`,
  },

  pip: {
    description: 'pip wrapper with Python seatbelt isolation',
    usesSeatbelt: true,
    generate: (config) => `#!/bin/bash
# pip wrapper - runs pip with AgenShield network isolation via seatbelt

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

PYTHON_PATH="\${AGENSHIELD_PYTHON:-${config.pythonPath}}"
SEATBELT_PROFILE="${config.seatbeltDir}/python.sb"

# Use seatbelt for network isolation if available
if [ -f "$SEATBELT_PROFILE" ]; then
  exec /usr/bin/sandbox-exec -f "$SEATBELT_PROFILE" "$PYTHON_PATH" -m pip "$@"
else
  # Fallback: use the wrapper's Python
  exec ${config.agentHome}/bin/python -m pip "$@"
fi
`,
  },

  python: {
    description: 'python wrapper with seatbelt network isolation',
    usesSeatbelt: true,
    generate: (config) => `#!/bin/bash
# python wrapper - runs Python with AgenShield seatbelt network isolation
# Network access is denied by seatbelt profile

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

PYTHON_PATH="\${AGENSHIELD_PYTHON:-${config.pythonPath}}"
SEATBELT_PROFILE="${config.seatbeltDir}/python.sb"

# Set AgenShield environment
export AGENSHIELD_SOCKET="${config.socketPath}"
export AGENSHIELD_HTTP_PORT="${config.httpPort}"

# Use seatbelt for network isolation
if [ -f "$SEATBELT_PROFILE" ]; then
  exec /usr/bin/sandbox-exec -f "$SEATBELT_PROFILE" "$PYTHON_PATH" "$@"
else
  # Warning: running without seatbelt isolation
  echo "[AgenShield] Warning: Running Python without seatbelt isolation" >&2
  exec "$PYTHON_PATH" "$@"
fi
`,
  },

  python3: {
    description: 'python3 wrapper with seatbelt network isolation',
    usesSeatbelt: true,
    generate: (config) => `#!/bin/bash
# python3 wrapper - alias to python wrapper

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

exec ${config.agentHome}/bin/python "$@"
`,
  },

  node: {
    description: 'node wrapper with AgenShield interceptor',
    usesInterceptor: true,
    generate: (config) => `#!/bin/bash
# node wrapper - runs Node.js with AgenShield interceptor
# All network and exec operations are intercepted

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

# Set up interceptor
export NODE_OPTIONS="${config.interceptorFlag} ${config.interceptorPath} \${NODE_OPTIONS:-}"

# Set AgenShield environment
export AGENSHIELD_SOCKET="${config.socketPath}"
export AGENSHIELD_HTTP_PORT="${config.httpPort}"
export AGENSHIELD_INTERCEPT_FETCH=true
export AGENSHIELD_INTERCEPT_HTTP=true
export AGENSHIELD_INTERCEPT_EXEC=true

# Set execution context (agent level by default, skills override via skill-injector)
export AGENSHIELD_CONTEXT_TYPE=\${AGENSHIELD_CONTEXT_TYPE:-agent}

# Find node - prefer copied binary, then homebrew, then system
if [ -x "/opt/agenshield/bin/node-bin" ]; then
  exec /opt/agenshield/bin/node-bin "$@"
elif [ -x "/opt/homebrew/bin/node" ]; then
  exec /opt/homebrew/bin/node "$@"
elif [ -x "${config.nodePath}" ]; then
  exec ${config.nodePath} "$@"
else
  echo "node not found" >&2
  exit 1
fi
`,
  },

  npx: {
    description: 'npx wrapper with Node.js interceptor',
    usesInterceptor: true,
    generate: (config) => `#!/bin/bash
# npx wrapper - runs npx with AgenShield interceptor

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

# Set up interceptor
export NODE_OPTIONS="${config.interceptorFlag} ${config.interceptorPath} \${NODE_OPTIONS:-}"

# Set AgenShield environment
export AGENSHIELD_SOCKET="${config.socketPath}"
export AGENSHIELD_HTTP_PORT="${config.httpPort}"
export AGENSHIELD_INTERCEPT_FETCH=true
export AGENSHIELD_INTERCEPT_HTTP=true

# Set execution context
export AGENSHIELD_CONTEXT_TYPE=\${AGENSHIELD_CONTEXT_TYPE:-agent}

# Find npx
if [ -x "/opt/homebrew/bin/npx" ]; then
  exec /opt/homebrew/bin/npx "$@"
elif [ -x "/usr/local/bin/npx" ]; then
  exec /usr/local/bin/npx "$@"
else
  echo "npx not found" >&2
  exit 1
fi
`,
  },

  brew: {
    description: 'brew wrapper that routes through broker',
    generate: (config) => `#!/bin/bash
# brew wrapper - routes Homebrew network operations through broker
# Install/update/upgrade operations are monitored

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"

# Check if this is a network operation
case "$1" in
  install|reinstall|upgrade|update|fetch|tap|untap)
    # Route through broker for network ops
    exec /opt/agenshield/bin/shield-client brew "$@"
    ;;
  *)
    # Local operations pass through directly
    if [ -x "/opt/homebrew/bin/brew" ]; then
      exec /opt/homebrew/bin/brew "$@"
    elif [ -x "/usr/local/bin/brew" ]; then
      exec /usr/local/bin/brew "$@"
    else
      echo "brew not found" >&2
      exit 1
    fi
    ;;
esac
`,
  },

  'open-url': {
    description: 'Open URL through broker',
    generate: (config) => `#!/bin/bash
# open-url - opens URLs through the broker

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

URL="$1"

if [ -z "$URL" ]; then
  echo "Usage: open-url <url>" >&2
  exit 1
fi

exec /opt/agenshield/bin/shield-client open "$URL"
`,
  },

  ssh: {
    description: 'ssh wrapper that routes through broker',
    generate: (config) => `#!/bin/bash
# ssh wrapper - routes SSH connections through broker for monitoring

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"

# Route through broker
exec /opt/agenshield/bin/shield-client ssh "$@"
`,
  },

  scp: {
    description: 'scp wrapper that routes through broker',
    generate: (config) => `#!/bin/bash
# scp wrapper - routes SCP transfers through broker for monitoring

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

SOCKET_PATH="\${AGENSHIELD_SOCKET:-${config.socketPath}}"

# Route through broker
exec /opt/agenshield/bin/shield-client scp "$@"
`,
  },
};

/**
 * Legacy static WRAPPERS export for backward compatibility
 */
export const WRAPPERS = Object.fromEntries(
  Object.entries(WRAPPER_DEFINITIONS).map(([name, def]) => [
    name,
    {
      description: def.description,
      content: def.generate(getDefaultWrapperConfig()),
    },
  ])
) as Record<string, { description: string; content: string }>;

export interface WrapperResult {
  success: boolean;
  name: string;
  path: string;
  message: string;
  error?: Error;
}

/**
 * Generate wrapper content from definition
 */
export function generateWrapperContent(
  name: string,
  config?: WrapperConfig
): string | null {
  const def = WRAPPER_DEFINITIONS[name];
  if (!def) {
    return null;
  }
  return def.generate(config || getDefaultWrapperConfig());
}

/**
 * Install a single wrapper
 */
export async function installWrapper(
  name: string,
  content: string,
  targetDir: string
): Promise<WrapperResult> {
  const wrapperPath = path.join(targetDir, name);

  try {
    // Write wrapper script
    await fs.writeFile(wrapperPath, content, { mode: 0o755 });

    return {
      success: true,
      name,
      path: wrapperPath,
      message: `Installed ${name}`,
    };
  } catch (error) {
    return {
      success: false,
      name,
      path: wrapperPath,
      message: `Failed to install ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Install a wrapper with sudo (for system directories)
 */
export async function installWrapperWithSudo(
  name: string,
  content: string,
  targetDir: string,
  owner?: string,
  group?: string
): Promise<WrapperResult> {
  const wrapperPath = path.join(targetDir, name);

  try {
    // Write via sudo
    await execAsync(`sudo tee "${wrapperPath}" > /dev/null << 'EOF'
${content}
EOF`);
    await execAsync(`sudo chmod 755 "${wrapperPath}"`);

    if (owner && group) {
      await execAsync(`sudo chown ${owner}:${group} "${wrapperPath}"`);
    }

    return {
      success: true,
      name,
      path: wrapperPath,
      message: `Installed ${name} (with sudo)`,
    };
  } catch (error) {
    return {
      success: false,
      name,
      path: wrapperPath,
      message: `Failed to install ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Install all wrappers
 */
export async function installWrappers(
  targetDir: string = '/Users/agenshield_agent/bin',
  config?: WrapperConfig
): Promise<WrapperResult[]> {
  const results: WrapperResult[] = [];
  const wrapperConfig = config || getDefaultWrapperConfig();

  // Ensure target directory exists
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch {
    // Permission denied or already exists — try sudo
    try {
      await execAsync(`sudo mkdir -p "${targetDir}"`);
    } catch {
      // Directory likely exists
    }
  }

  for (const [name, def] of Object.entries(WRAPPER_DEFINITIONS)) {
    const content = def.generate(wrapperConfig);
    // Try direct write first, fall back to sudo for root-owned directories
    let result = await installWrapper(name, content, targetDir);
    if (!result.success && result.error && (result.error as NodeJS.ErrnoException).code === 'EACCES') {
      result = await installWrapperWithSudo(name, content, targetDir);
    }
    results.push(result);
  }

  return results;
}

/**
 * Install specific wrappers by name
 */
export async function installSpecificWrappers(
  names: string[],
  targetDir: string,
  config?: WrapperConfig
): Promise<WrapperResult[]> {
  const results: WrapperResult[] = [];
  const wrapperConfig = config || getDefaultWrapperConfig();

  // Ensure target directory exists
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch {
    // Permission denied or already exists — try sudo
    try {
      await execAsync(`sudo mkdir -p "${targetDir}"`);
    } catch {
      // Directory likely exists
    }
  }

  for (const name of names) {
    const def = WRAPPER_DEFINITIONS[name];
    if (!def) {
      results.push({
        success: false,
        name,
        path: path.join(targetDir, name),
        message: `Unknown wrapper: ${name}`,
      });
      continue;
    }

    const content = def.generate(wrapperConfig);
    // Try direct write first, fall back to sudo for root-owned directories
    let result = await installWrapper(name, content, targetDir);
    if (!result.success && result.error && (result.error as NodeJS.ErrnoException).code === 'EACCES') {
      result = await installWrapperWithSudo(name, content, targetDir);
    }
    results.push(result);
  }

  return results;
}

/**
 * Uninstall a wrapper
 */
export async function uninstallWrapper(
  name: string,
  targetDir: string
): Promise<WrapperResult> {
  const wrapperPath = path.join(targetDir, name);

  try {
    await fs.unlink(wrapperPath);

    return {
      success: true,
      name,
      path: wrapperPath,
      message: `Uninstalled ${name}`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: true,
        name,
        path: wrapperPath,
        message: `${name} not found (already removed)`,
      };
    }

    return {
      success: false,
      name,
      path: wrapperPath,
      message: `Failed to uninstall ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Uninstall all wrappers
 */
export async function uninstallWrappers(
  targetDir: string = '/Users/agenshield_agent/bin'
): Promise<WrapperResult[]> {
  const results: WrapperResult[] = [];

  for (const name of Object.keys(WRAPPER_DEFINITIONS)) {
    const result = await uninstallWrapper(name, targetDir);
    results.push(result);
  }

  return results;
}

/**
 * Verify wrapper installation
 */
export async function verifyWrappers(
  targetDir: string = '/Users/agenshield_agent/bin'
): Promise<{
  valid: boolean;
  installed: string[];
  missing: string[];
}> {
  const installed: string[] = [];
  const missing: string[] = [];

  for (const name of Object.keys(WRAPPER_DEFINITIONS)) {
    const wrapperPath = path.join(targetDir, name);
    try {
      await fs.access(wrapperPath, fs.constants.X_OK);
      installed.push(name);
    } catch {
      missing.push(name);
    }
  }

  return {
    valid: missing.length === 0,
    installed,
    missing,
  };
}

/**
 * Install all wrappers using UserConfig
 *
 * @param userConfig - UserConfig with user information
 * @param directories - Directories configuration
 */
export async function installAllWrappers(
  userConfig: UserConfig,
  directories: { binDir: string; wrappersDir: string }
): Promise<{
  success: boolean;
  error?: string;
  installed?: string[];
}> {
  const targetDir = directories.wrappersDir || directories.binDir;
  const wrapperConfig = getDefaultWrapperConfig(userConfig);
  const results = await installWrappers(targetDir, wrapperConfig);

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    return {
      success: false,
      error: failed.map((r) => r.message).join('; '),
      installed: results.filter((r) => r.success).map((r) => r.name),
    };
  }

  return {
    success: true,
    installed: results.map((r) => r.name),
  };
}

/**
 * Verbose logging options
 */
export interface VerboseOptions {
  verbose?: boolean;
}

/**
 * Install guarded shell using the hardened zsh guarded-shell content
 */
export async function installGuardedShell(
  userConfig?: UserConfig,
  options?: VerboseOptions
): Promise<WrapperResult> {
  const log = (msg: string) => options?.verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  // Use the hardened guarded shell from guarded-shell.ts (ZDOTDIR approach)
  const {
    GUARDED_SHELL_PATH,
    GUARDED_SHELL_CONTENT,
    ZDOT_DIR,
    ZDOT_ZSHENV_CONTENT,
    ZDOT_ZSHRC_CONTENT,
  } = await import('./guarded-shell');
  const shellPath = GUARDED_SHELL_PATH;

  try {
    // 1. Install the guarded-shell launcher
    log(`Installing guarded shell launcher to ${shellPath}`);
    await execAsync(`sudo mkdir -p "${path.dirname(shellPath)}"`);
    await execAsync(`sudo tee "${shellPath}" > /dev/null << 'GUARDEDEOF'
${GUARDED_SHELL_CONTENT}
GUARDEDEOF`);
    await execAsync(`sudo chmod 755 "${shellPath}"`);

    // Add to /etc/shells
    const { stdout } = await execAsync('cat /etc/shells');
    if (!stdout.includes(shellPath)) {
      log(`Adding ${shellPath} to /etc/shells`);
      await execAsync(`echo "${shellPath}" | sudo tee -a /etc/shells > /dev/null`);
    }

    // 2. Install ZDOTDIR files (root-owned, agent cannot modify)
    log(`Creating ZDOTDIR at ${ZDOT_DIR}`);
    await execAsync(`sudo mkdir -p "${ZDOT_DIR}"`);

    log(`Installing .zshenv to ${ZDOT_DIR}/.zshenv`);
    await execAsync(`sudo tee "${ZDOT_DIR}/.zshenv" > /dev/null << 'ZSHENVEOF'
${ZDOT_ZSHENV_CONTENT}
ZSHENVEOF`);
    await execAsync(`sudo chmod 644 "${ZDOT_DIR}/.zshenv"`);

    log(`Installing .zshrc to ${ZDOT_DIR}/.zshrc`);
    await execAsync(`sudo tee "${ZDOT_DIR}/.zshrc" > /dev/null << 'ZSHRCEOF'
${ZDOT_ZSHRC_CONTENT}
ZSHRCEOF`);
    await execAsync(`sudo chmod 644 "${ZDOT_DIR}/.zshrc"`);

    // Lock down the ZDOTDIR: root-owned, no write for anyone else
    log(`Locking down ZDOTDIR (root:wheel ownership)`);
    await execAsync(`sudo chown -R root:wheel "${ZDOT_DIR}"`);
    await execAsync(`sudo chmod 755 "${ZDOT_DIR}"`);

    return {
      success: true,
      name: 'guarded-shell',
      path: shellPath,
      message: 'Installed guarded shell + ZDOTDIR',
    };
  } catch (error) {
    return {
      success: false,
      name: 'guarded-shell',
      path: shellPath,
      message: `Failed to install guarded shell: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Install the shield-exec Node.js command proxy and create symlinks.
 *
 * Writes shield-exec to /opt/agenshield/bin/shield-exec (root-owned, mode 755),
 * then creates symlinks in the agent's bin directory for all proxied commands.
 * node/python are kept as separate bash wrappers (they need NODE_OPTIONS/seatbelt).
 */
export async function installShieldExec(
  userConfig: UserConfig,
  binDir: string
): Promise<{
  success: boolean;
  error?: string;
  installed?: string[];
}> {
  const { SHIELD_EXEC_CONTENT, SHIELD_EXEC_PATH, PROXIED_COMMANDS } = await import('./shield-exec');
  const socketGroupName = userConfig.groups.socket.name;
  const wrapperConfig = getDefaultWrapperConfig(userConfig);
  const installed: string[] = [];

  try {
    // 1. Write shield-exec to /opt/agenshield/bin/shield-exec (root-owned, 755)
    await execAsync(`sudo tee "${SHIELD_EXEC_PATH}" > /dev/null << 'SHIELDEXECEOF'
${SHIELD_EXEC_CONTENT}
SHIELDEXECEOF`);
    await execAsync(`sudo chmod 755 "${SHIELD_EXEC_PATH}"`);
    await execAsync(`sudo chown root:wheel "${SHIELD_EXEC_PATH}"`);

    // 2. Create symlinks in binDir for all proxied commands
    for (const cmd of PROXIED_COMMANDS) {
      const symlinkPath = path.join(binDir, cmd);
      try {
        // Remove existing file/symlink
        await execAsync(`sudo rm -f "${symlinkPath}"`);
        // Create symlink to shield-exec
        await execAsync(`sudo ln -s "${SHIELD_EXEC_PATH}" "${symlinkPath}"`);
        installed.push(cmd);
      } catch {
        // Continue on individual symlink failures
      }
    }

    // 3. Install node and python as separate bash wrappers (they need special env)
    const nodeWrapper = `#!/bin/bash
# node wrapper - runs Node.js with AgenShield interceptor

# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

export NODE_OPTIONS="${wrapperConfig.interceptorFlag} ${wrapperConfig.interceptorPath} \${NODE_OPTIONS:-}"
export AGENSHIELD_SOCKET="${wrapperConfig.socketPath}"
export AGENSHIELD_HTTP_PORT="${wrapperConfig.httpPort}"
export AGENSHIELD_INTERCEPT_FETCH=true
export AGENSHIELD_INTERCEPT_HTTP=true
export AGENSHIELD_INTERCEPT_EXEC=true
export AGENSHIELD_CONTEXT_TYPE=\${AGENSHIELD_CONTEXT_TYPE:-agent}
if [ -x "/opt/agenshield/bin/node-bin" ]; then
  exec /opt/agenshield/bin/node-bin "$@"
elif [ -x "/opt/homebrew/bin/node" ]; then
  exec /opt/homebrew/bin/node "$@"
elif [ -x "/usr/local/bin/node" ]; then
  exec /usr/local/bin/node "$@"
else
  echo "node not found" >&2
  exit 1
fi
`;

    const pythonWrapper = WRAPPER_DEFINITIONS['python']?.generate(wrapperConfig) || '';
    const python3Wrapper = WRAPPER_DEFINITIONS['python3']?.generate(wrapperConfig) || '';
    const pip3Wrapper = WRAPPER_DEFINITIONS['pip']?.generate(wrapperConfig) || '';

    // Write node wrapper
    const nodePath = path.join(binDir, 'node');
    await execAsync(`sudo tee "${nodePath}" > /dev/null << 'NODEEOF'
${nodeWrapper}
NODEEOF`);
    await execAsync(`sudo chmod 755 "${nodePath}"`);
    installed.push('node');

    // Write python wrapper
    const pythonPath = path.join(binDir, 'python');
    await execAsync(`sudo tee "${pythonPath}" > /dev/null << 'PYEOF'
${pythonWrapper}
PYEOF`);
    await execAsync(`sudo chmod 755 "${pythonPath}"`);
    installed.push('python');

    // Write python3 wrapper
    const python3Path = path.join(binDir, 'python3');
    await execAsync(`sudo tee "${python3Path}" > /dev/null << 'PY3EOF'
${python3Wrapper}
PY3EOF`);
    await execAsync(`sudo chmod 755 "${python3Path}"`);
    installed.push('python3');

    // 4. Lock down wrapper files as root-owned, then restore bin dir for broker writes
    await execAsync(`sudo chown -R root:${socketGroupName} "${binDir}"`);
    await execAsync(`sudo chown ${userConfig.brokerUser.username}:${socketGroupName} "${binDir}"`);
    await execAsync(`sudo chmod 2775 "${binDir}"`);

    return { success: true, installed };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
      installed,
    };
  }
}

/**
 * Get list of available wrapper names
 */
export function getAvailableWrappers(): string[] {
  return Object.keys(WRAPPER_DEFINITIONS);
}

/**
 * Get wrapper definition by name
 */
export function getWrapperDefinition(name: string): WrapperDefinition | null {
  return WRAPPER_DEFINITIONS[name] || null;
}

/**
 * Check if a wrapper uses seatbelt
 */
export function wrapperUsesSeatbelt(name: string): boolean {
  const def = WRAPPER_DEFINITIONS[name];
  return def?.usesSeatbelt || false;
}

/**
 * Check if a wrapper uses interceptor
 */
export function wrapperUsesInterceptor(name: string): boolean {
  const def = WRAPPER_DEFINITIONS[name];
  return def?.usesInterceptor || false;
}

/**
 * Dynamic wrapper management - add a new wrapper at runtime
 */
export async function addDynamicWrapper(
  name: string,
  content: string,
  targetDir: string,
  useSudo: boolean = false,
  owner?: string,
  group?: string
): Promise<WrapperResult> {
  if (useSudo) {
    return installWrapperWithSudo(name, content, targetDir, owner, group);
  }
  return installWrapper(name, content, targetDir);
}

/**
 * Dynamic wrapper management - remove a wrapper at runtime
 */
export async function removeDynamicWrapper(
  name: string,
  targetDir: string,
  useSudo: boolean = false
): Promise<WrapperResult> {
  const wrapperPath = path.join(targetDir, name);

  try {
    if (useSudo) {
      await execAsync(`sudo rm -f "${wrapperPath}"`);
    } else {
      await fs.unlink(wrapperPath);
    }

    return {
      success: true,
      name,
      path: wrapperPath,
      message: `Removed dynamic wrapper ${name}`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: true,
        name,
        path: wrapperPath,
        message: `${name} not found (already removed)`,
      };
    }

    return {
      success: false,
      name,
      path: wrapperPath,
      message: `Failed to remove ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Update an existing wrapper with new content
 */
export async function updateWrapper(
  name: string,
  targetDir: string,
  config?: WrapperConfig,
  useSudo: boolean = false
): Promise<WrapperResult> {
  const def = WRAPPER_DEFINITIONS[name];
  if (!def) {
    return {
      success: false,
      name,
      path: path.join(targetDir, name),
      message: `Unknown wrapper: ${name}`,
    };
  }

  const content = def.generate(config || getDefaultWrapperConfig());

  if (useSudo) {
    return installWrapperWithSudo(name, content, targetDir);
  }
  return installWrapper(name, content, targetDir);
}

/**
 * Deploy the interceptor CJS bundle to the sandbox.
 *
 * Copies `@agenshield/interceptor/register` (CJS despite the package.json
 * "type":"module") to `/opt/agenshield/lib/interceptor/register.cjs`
 * so that node wrappers can use `--require` to load it.
 */
export async function deployInterceptor(
  userConfig?: UserConfig
): Promise<WrapperResult> {
  const targetPath = '/opt/agenshield/lib/interceptor/register.cjs';
  const socketGroupName = userConfig?.groups?.socket?.name || 'ash_socket';

  try {
    // Resolve via package name so it works regardless of directory layout
    const srcPath = require.resolve('@agenshield/interceptor/register');

    // Verify source exists
    await fs.access(srcPath);

    // Ensure target directory exists
    await execAsync('sudo mkdir -p /opt/agenshield/lib/interceptor');

    // Copy the file, renaming to .cjs
    await execAsync(`sudo cp "${srcPath}" "${targetPath}"`);
    await execAsync(`sudo chown root:${socketGroupName} "${targetPath}"`);
    await execAsync(`sudo chmod 644 "${targetPath}"`);

    return {
      success: true,
      name: 'interceptor',
      path: targetPath,
      message: 'Deployed interceptor to ' + targetPath,
    };
  } catch (error) {
    return {
      success: false,
      name: 'interceptor',
      path: targetPath,
      message: `Failed to deploy interceptor: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Copy the broker binary to /opt/agenshield/bin/
 * The broker is the privileged daemon that handles socket communication.
 */
export async function copyBrokerBinary(
  userConfig?: UserConfig
): Promise<WrapperResult> {
  const targetPath = '/opt/agenshield/bin/agenshield-broker';
  const socketGroupName = userConfig?.groups?.socket?.name || 'ash_socket';

  try {
    // Get the broker main.js from this package's installed location
    // Resolve the bin path from package.json so it works both in monorepo (dist/main.js)
    // and when published (main.js directly in package root)
    const brokerPkgPath = require.resolve('@agenshield/broker/package.json');
    const brokerDir = path.dirname(brokerPkgPath);
    const brokerPkg = JSON.parse(await fs.readFile(brokerPkgPath, 'utf-8'));
    const binEntry = typeof brokerPkg.bin === 'string'
      ? brokerPkg.bin
      : brokerPkg.bin?.['agenshield-broker'] || './dist/main.js';
    const srcPath = path.resolve(brokerDir, binEntry);

    // Verify source exists
    await fs.access(srcPath);

    // Create target directory if needed
    await execAsync('sudo mkdir -p /opt/agenshield/bin');

    // Copy the broker binary
    await execAsync(`sudo cp "${srcPath}" "${targetPath}"`);
    await execAsync(`sudo chmod 755 "${targetPath}"`);
    await execAsync(`sudo chown root:${socketGroupName} "${targetPath}"`);

    // Create a package.json at /opt/agenshield/ so Node.js treats .js files as ESM.
    // The broker binary is built with esbuild format:"esm" and uses `import` statements.
    // Without this, Node defaults to CJS and crashes with "Cannot use import statement".
    await execAsync(
      `sudo tee /opt/agenshield/package.json > /dev/null << 'PKGJSONEOF'
{"type":"module"}
PKGJSONEOF`
    );
    await execAsync(`sudo chown root:wheel /opt/agenshield/package.json`);
    await execAsync(`sudo chmod 644 /opt/agenshield/package.json`);

    return {
      success: true,
      name: 'agenshield-broker',
      path: targetPath,
      message: `Broker binary installed to ${targetPath}`,
    };
  } catch (error) {
    return {
      success: false,
      name: 'agenshield-broker',
      path: targetPath,
      message: `Failed to install broker: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Copy the shield-client binary to /opt/agenshield/bin/
 * Shield-client is the CLI used by wrapper scripts (curl, git, etc.) to route
 * operations through the broker.
 *
 * IMPORTANT: The shebang is rewritten from #!/usr/bin/env node to
 * #!/opt/agenshield/bin/node-bin so that shield-client runs WITHOUT the
 * interceptor. Otherwise there's an infinite recursion:
 * interceptor → curl wrapper → shield-client → node+interceptor → …
 */
export async function copyShieldClient(
  userConfig?: UserConfig
): Promise<WrapperResult> {
  const targetPath = '/opt/agenshield/bin/shield-client';
  const socketGroupName = userConfig?.groups?.socket?.name || 'ash_socket';

  try {
    // Resolve the shield-client from the broker package
    const brokerPkgPath = require.resolve('@agenshield/broker/package.json');
    const brokerDir = path.dirname(brokerPkgPath);
    const brokerPkg = JSON.parse(await fs.readFile(brokerPkgPath, 'utf-8'));
    const clientEntry = typeof brokerPkg.bin === 'object'
      ? brokerPkg.bin['shield-client']
      : null;
    const srcPath = path.resolve(brokerDir, clientEntry || './dist/client/shield-client.js');

    // Verify source exists
    await fs.access(srcPath);

    // Read and rewrite shebang to use node-bin directly (bypass interceptor)
    let content = await fs.readFile(srcPath, 'utf-8');
    content = content.replace(
      /^#!\/usr\/bin\/env node/,
      '#!/opt/agenshield/bin/node-bin'
    );

    // Write via temp file + sudo mv
    const tmpPath = '/tmp/shield-client-install';
    await fs.writeFile(tmpPath, content, { mode: 0o755 });

    await execAsync('sudo mkdir -p /opt/agenshield/bin');
    await execAsync(`sudo mv "${tmpPath}" "${targetPath}"`);
    await execAsync(`sudo chmod 755 "${targetPath}"`);
    await execAsync(`sudo chown root:${socketGroupName} "${targetPath}"`);

    return {
      success: true,
      name: 'shield-client',
      path: targetPath,
      message: `Shield-client installed to ${targetPath}`,
    };
  } catch (error) {
    return {
      success: false,
      name: 'shield-client',
      path: targetPath,
      message: `Failed to install shield-client: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Detect and copy Node.js dynamic libraries (dylibs) alongside the binary.
 *
 * On macOS, Node.js 22+ (especially NVM builds) is dynamically linked to
 * `libnode.127.dylib` via `@loader_path/../lib/libnode.127.dylib`.
 * When the binary runs from `/opt/agenshield/bin/`, this resolves to
 * `/opt/agenshield/lib/libnode.127.dylib` — which doesn't exist unless
 * we copy it there.
 *
 * Graceful no-op when: node is statically linked, `otool` is unavailable
 * (non-macOS), or no matching dylibs are found.
 */
async function copyNodeDylibs(
  srcBinaryPath: string,
  socketGroupName: string
): Promise<{ copied: string[]; errors: string[] }> {
  const copied: string[] = [];
  const errors: string[] = [];

  try {
    const { stdout } = await execAsync(`/usr/bin/otool -L "${srcBinaryPath}"`);
    const lines = stdout.split('\n');

    for (const line of lines) {
      // Match lines like: @loader_path/../lib/libnode.127.dylib (...)
      // or @rpath/libnode.127.dylib (...)
      const match = line.match(
        /\s+(@loader_path|@rpath)(\/[^\s]+\/)(libnode[^\s(]+)/
      );
      if (!match) continue;

      const prefix = match[1];     // @loader_path or @rpath
      const relPath = match[2];    // e.g. /../lib/
      const dylibName = match[3];  // e.g. libnode.127.dylib

      // Resolve the actual file on disk
      let resolvedPath: string;
      if (prefix === '@loader_path') {
        // @loader_path resolves relative to the binary's directory
        resolvedPath = path.resolve(path.dirname(srcBinaryPath) + relPath + dylibName);
      } else {
        // @rpath — try the binary's parent lib directory as a best guess
        resolvedPath = path.resolve(path.dirname(srcBinaryPath), '..', 'lib', dylibName);
      }

      try {
        await fs.access(resolvedPath);
      } catch {
        errors.push(`dylib not found on disk: ${resolvedPath}`);
        continue;
      }

      // Copy to /opt/agenshield/lib/ (directory already exists from setup)
      const targetPath = `/opt/agenshield/lib/${dylibName}`;
      try {
        await execAsync(`sudo cp "${resolvedPath}" "${targetPath}"`);
        await execAsync(`sudo chown root:${socketGroupName} "${targetPath}"`);
        await execAsync(`sudo chmod 755 "${targetPath}"`);
        copied.push(dylibName);
      } catch (err) {
        errors.push(`Failed to copy ${dylibName}: ${(err as Error).message}`);
      }
    }
  } catch {
    // otool not available or failed — non-macOS or static build, no-op
  }

  return { copied, errors };
}

/**
 * Copy the current Node.js binary to the sandbox so the node wrapper
 * can exec a known-good binary without relying on system PATH.
 */
export async function copyNodeBinary(
  userConfig?: UserConfig,
  sourcePath?: string,
): Promise<WrapperResult> {
  const targetPath = '/opt/agenshield/bin/node-bin';
  const socketGroupName = userConfig?.groups?.socket?.name || 'ash_socket';

  try {
    const srcPath = sourcePath || process.execPath;

    // Verify source exists
    await fs.access(srcPath);

    // Copy via sudo
    await execAsync(`sudo cp "${srcPath}" "${targetPath}"`);
    await execAsync(`sudo chown root:${socketGroupName} "${targetPath}"`);
    await execAsync(`sudo chmod 755 "${targetPath}"`);

    // Copy any dylibs the node binary is dynamically linked to (e.g. libnode.127.dylib on NVM builds)
    const dylibs = await copyNodeDylibs(srcPath, socketGroupName);
    const dylibInfo = dylibs.copied.length > 0
      ? ` (dylibs: ${dylibs.copied.join(', ')})`
      : '';

    return {
      success: true,
      name: 'node-bin',
      path: targetPath,
      message: `Copied node binary from ${srcPath} to ${targetPath}${dylibInfo}`,
    };
  } catch (error) {
    return {
      success: false,
      name: 'node-bin',
      path: targetPath,
      message: `Failed to copy node binary: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Result of NVM + Node.js installation for the agent user
 */
export interface NvmInstallResult {
  success: boolean;
  nvmDir: string;
  nodeVersion: string;
  nodeBinaryPath: string;
  message: string;
  error?: Error;
}

const NVM_INSTALL_URL = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh';

/**
 * Install NVM and a specific Node.js version for the agent user.
 *
 * Runs as the agent user via `sudo -u` with `/bin/bash` (not guarded-shell).
 * The NVM directory is created under the agent's home so versions can be
 * managed independently of the host system.
 *
 * The installed node binary is then copied to /opt/agenshield/bin/node-bin
 * by the caller via copyNodeBinary(userConfig, nodeBinaryPath).
 */
export async function installAgentNvm(options: {
  agentHome: string;
  agentUsername: string;
  socketGroupName: string;
  nodeVersion?: string;
  verbose?: boolean;
}): Promise<NvmInstallResult> {
  const { agentHome, agentUsername, socketGroupName, verbose } = options;
  const nodeVersion = options.nodeVersion || '24';
  const nvmDir = `${agentHome}/.nvm`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  const empty: NvmInstallResult = {
    success: false,
    nvmDir,
    nodeVersion,
    nodeBinaryPath: '',
    message: '',
  };

  try {
    // 1. Ensure .nvm directory exists with correct ownership
    log(`Creating NVM directory at ${nvmDir}`);
    await execAsync(`sudo mkdir -p "${nvmDir}"`);
    await execAsync(`sudo chown ${agentUsername}:${socketGroupName} "${nvmDir}"`);
    await execAsync(`sudo chmod 755 "${nvmDir}"`);

    // 2. Download and install NVM as the agent user
    // PROFILE=/dev/null prevents NVM from modifying shell rc files
    // --norc --noprofile prevents loading the calling user's rc files
    // cd / avoids getcwd errors when cwd is inaccessible to the agent user
    log('Downloading and installing NVM');
    const installCmd = [
      `cd /`,
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `/usr/bin/curl -o- "${NVM_INSTALL_URL}" | PROFILE=/dev/null /bin/bash`,
    ].join(' && ');
    await execAsync(`sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${installCmd}'`, { timeout: 60000 });

    // 3. Install the specified Node.js version
    log(`Installing Node.js v${nodeVersion} via NVM`);
    const nvmInstallCmd = [
      `cd /`,
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `source "${nvmDir}/nvm.sh"`,
      `nvm install ${nodeVersion}`,
    ].join(' && ');
    await execAsync(`sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${nvmInstallCmd}'`, { timeout: 120000 });

    // 4. Resolve the installed node binary path
    log('Resolving installed node binary path');
    const whichCmd = [
      `cd /`,
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `source "${nvmDir}/nvm.sh"`,
      `nvm which ${nodeVersion}`,
    ].join(' && ');
    const { stdout } = await execAsync(`sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${whichCmd}'`);
    const nodeBinaryPath = stdout.trim();

    if (!nodeBinaryPath) {
      return { ...empty, message: 'NVM installed but could not resolve node binary path' };
    }

    // 5. Verify the binary works
    log(`Verifying node binary at ${nodeBinaryPath}`);
    const { stdout: versionOut } = await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c 'cd / && "${nodeBinaryPath}" --version'`
    );
    const actualVersion = versionOut.trim();
    log(`Node.js ${actualVersion} installed successfully`);

    return {
      success: true,
      nvmDir,
      nodeVersion: actualVersion,
      nodeBinaryPath,
      message: `Installed Node.js ${actualVersion} via NVM at ${nodeBinaryPath}`,
    };
  } catch (error) {
    return {
      ...empty,
      message: `NVM installation failed: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

export interface PresetInstallResult {
  success: boolean;
  installedWrappers: string[];
  errors: string[];
  seatbeltInstalled: boolean;
}

/**
 * Basic system commands that should be available via symlinks (no interception needed)
 */
export const BASIC_SYSTEM_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'find',
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'pwd', 'basename', 'dirname',
  'wc', 'sort', 'uniq', 'tr', 'cut', 'sed', 'awk', 'date', 'touch',
  'chmod', 'file', 'which', 'env', 'echo', 'printf', 'test', 'true', 'false',
  'id', 'whoami', 'hostname', 'uname', 'tee', 'xargs', 'diff', 'tar', 'gzip', 'gunzip',
];

/**
 * Install symlinks for basic system commands that don't need interception
 */
export async function installBasicCommands(
  binDir: string,
  options?: { verbose?: boolean }
): Promise<{ success: boolean; installed: string[]; errors: string[] }> {
  const log = (msg: string) => options?.verbose && process.stderr.write(`[SETUP] ${msg}\n`);
  const installed: string[] = [];
  const errors: string[] = [];

  for (const cmd of BASIC_SYSTEM_COMMANDS) {
    // Check common locations for the command
    const locations = [`/bin/${cmd}`, `/usr/bin/${cmd}`];
    let found = false;

    for (const loc of locations) {
      try {
        await fs.access(loc, fs.constants.X_OK);
        const symlinkPath = path.join(binDir, cmd);

        log(`Creating symlink: ${cmd} -> ${loc}`);
        await execAsync(`sudo ln -sf "${loc}" "${symlinkPath}"`);
        installed.push(cmd);
        found = true;
        break;
      } catch {
        // Not found at this location, try next
      }
    }

    if (!found) {
      // Command not found in standard locations, skip silently
    }
  }

  return { success: errors.length === 0, installed, errors };
}

/**
 * Install binaries for a preset: node binary, interceptor, wrappers, seatbelt, ownership lockdown.
 */
export async function installPresetBinaries(options: {
  requiredBins: string[];
  userConfig: UserConfig;
  binDir: string;
  socketGroupName: string;
  nodeVersion?: string;
  verbose?: boolean;
}): Promise<PresetInstallResult> {
  const { requiredBins, userConfig, binDir, socketGroupName, verbose } = options;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);
  const errors: string[] = [];
  const installedWrappers: string[] = [];
  let seatbeltInstalled = false;

  // 1. Install node binary to /opt/agenshield/bin/node-bin (if 'node' in requiredBins)
  if (requiredBins.includes('node')) {
    const agentHome = userConfig.agentUser.home;
    const agentUsername = userConfig.agentUser.username;

    // Try NVM-based install first for version control
    log('Installing NVM + Node.js for agent user');
    const nvmResult = await installAgentNvm({
      agentHome,
      agentUsername,
      socketGroupName,
      nodeVersion: options.nodeVersion,
      verbose,
    });

    if (nvmResult.success) {
      log(`NVM installed Node.js ${nvmResult.nodeVersion} at ${nvmResult.nodeBinaryPath}`);
      log('Copying NVM node binary to /opt/agenshield/bin/node-bin');
      const nodeResult = await copyNodeBinary(userConfig, nvmResult.nodeBinaryPath);
      if (!nodeResult.success) {
        errors.push(`Node binary (from NVM): ${nodeResult.message}`);
      }
    } else {
      // Fallback: copy host's node binary (original behavior)
      log(`NVM install failed: ${nvmResult.message}. Falling back to host node binary.`);
      log('Copying node binary to /opt/agenshield/bin/node-bin');
      const nodeResult = await copyNodeBinary(userConfig);
      if (!nodeResult.success) {
        errors.push(`Node binary: ${nodeResult.message}`);
      }
    }
  }

  // 2. Deploy interceptor (if any required bin uses it)
  const needsInterceptor = requiredBins.some(
    name => WRAPPER_DEFINITIONS[name]?.usesInterceptor
  );
  if (needsInterceptor) {
    log(`Deploying interceptor to /opt/agenshield/lib/interceptor/register.cjs`);
    const intResult = await deployInterceptor(userConfig);
    if (!intResult.success) {
      errors.push(`Interceptor: ${intResult.message}`);
    }
  }

  // 3. Install wrapper scripts for required bins
  const wrapperConfig = getDefaultWrapperConfig(userConfig);
  const validNames = requiredBins.filter(name => WRAPPER_DEFINITIONS[name]);
  for (const name of validNames) {
    log(`Installing wrapper: ${name} -> ${binDir}/${name}`);
  }
  const results = await installSpecificWrappers(validNames, binDir, wrapperConfig);
  for (const r of results) {
    if (r.success) {
      installedWrappers.push(r.name);
    } else {
      errors.push(`Wrapper ${r.name}: ${r.message}`);
    }
  }

  // 4. Install seatbelt profiles (only if python/pip wrappers are in the list)
  const needsSeatbelt = requiredBins.some(
    name => WRAPPER_DEFINITIONS[name]?.usesSeatbelt
  );
  if (needsSeatbelt) {
    try {
      log(`Installing seatbelt profiles`);
      const { generateAgentProfileFromConfig, installSeatbeltProfiles } = await import('./seatbelt');
      const agentProfile = generateAgentProfileFromConfig(userConfig);
      const sbResult = await installSeatbeltProfiles(userConfig, { agentProfile });
      seatbeltInstalled = sbResult.success;
      if (!sbResult.success) {
        errors.push(`Seatbelt: ${sbResult.error}`);
      }
    } catch (err) {
      errors.push(`Seatbelt: ${(err as Error).message}`);
    }
  }

  // 5. Install basic system commands as symlinks (ls, cat, grep, etc.)
  log(`Installing basic system commands as symlinks`);
  const basicResult = await installBasicCommands(binDir, { verbose });
  if (!basicResult.success) {
    errors.push(...basicResult.errors);
  }
  installedWrappers.push(...basicResult.installed);

  // 6. Lock down wrapper files: root-owned, mode 755 (agent can't modify)
  //    But keep bin dir broker-owned with 2775 so skills can be installed later
  try {
    log(`Locking down bin directory: root:${socketGroupName} file ownership`);
    await execAsync(`sudo chown -R root:${socketGroupName} "${binDir}"`);
    await execAsync(`sudo chmod -R 755 "${binDir}"`);
    // Restore bin dir itself to broker-owned, setgid + group-writable
    await execAsync(`sudo chown ${userConfig.brokerUser.username}:${socketGroupName} "${binDir}"`);
    await execAsync(`sudo chmod 2775 "${binDir}"`);
  } catch (err) {
    errors.push(`Lockdown: ${(err as Error).message}`);
  }

  return {
    success: errors.length === 0,
    installedWrappers,
    errors,
    seatbeltInstalled,
  };
}

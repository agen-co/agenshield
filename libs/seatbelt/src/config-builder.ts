/**
 * Sandbox Config Builder
 *
 * Builds SandboxConfig for approved exec operations.
 * Extracted from daemon RPC with dependency injection so it can be
 * used without direct daemon/storage/proxy dependencies.
 */

import * as crypto from 'node:crypto';
import * as nodefs from 'node:fs';
import type { SandboxConfig, PolicyConfig, PolicyExecutionContext, ResourceLimits } from '@agenshield/ipc';
import type { GraphEffects } from '@agenshield/policies';
import { extractCommandBasename, filterUrlPoliciesForCommand } from '@agenshield/policies';
import { collectDenyPathsFromPolicies, collectAllowPathsForCommand } from './paths';

/** Capabilities shared from parent to child via edge config */
export interface SharedCapabilities {
  networkPatterns: string[];
  fsPaths: { read: string[]; write: string[] };
  secretNames: string[];
}

/** Dependencies injected by the daemon (or test harness) */
export interface SeatbeltDeps {
  /** Acquire a per-run proxy. Returns port number. */
  acquireProxy?: (
    execId: string,
    command: string,
    policies: PolicyConfig[],
    defaultAction: string,
  ) => Promise<{ port: number }>;
  /** Resolve secret names to values from vault */
  resolveSecrets?: (names: string[]) => Record<string, string>;
  /** Get all enabled policies (for filesystem/URL filtering) */
  getPolicies: () => PolicyConfig[];
  /** Default action when no policy matches */
  defaultAction: string;
  /** Agent home directory (for binary path resolution) */
  agentHome: string;
  /** Broker HTTP fallback port */
  brokerHttpPort?: number;
  /** Resource monitoring configuration */
  resourceMonitoring?: {
    enabled: boolean;
    defaults?: ResourceLimits;
  };
}

/** Input for building a sandbox config */
export interface BuildSandboxInput {
  matchedPolicy?: PolicyConfig;
  context?: PolicyExecutionContext;
  target?: string;
  effects?: GraphEffects;
  traceId?: string;
  depth?: number;
  sharedCapabilities?: SharedCapabilities;
}

/**
 * System binaries that MUST be executed through broker wrapper scripts
 * (in agentHome/bin/) rather than directly. Direct execution bypasses
 * the broker's policy-checked wrappers.
 */
const WRAPPER_REQUIRED_BINARIES = [
  '/usr/bin/curl',
  '/usr/bin/wget',
  '/usr/bin/ssh',
  '/usr/bin/scp',
  '/usr/bin/rsync',
  '/usr/bin/git',
  '/usr/local/bin/git',
  '/usr/bin/npm',
  '/usr/local/bin/npm',
  '/usr/bin/npx',
  '/usr/local/bin/npx',
] as const;

// Known commands that typically need network access
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'git', 'npm', 'npx', 'yarn', 'pnpm',
  'pip', 'pip3', 'brew', 'apt', 'ssh', 'scp', 'rsync',
  'fetch', 'http', 'nc', 'ncat', 'node', 'deno', 'bun',
]);

/**
 * Determine the network access mode for a sandboxed command.
 *
 * Priority:
 * 1. Explicit networkAccess on matched policy
 * 2. Known network command → always proxy
 * 3. Default → none (non-network commands)
 */
function determineNetworkAccess(
  matchedPolicy: PolicyConfig | undefined,
  target: string,
): 'none' | 'proxy' | 'direct' {
  if (matchedPolicy?.networkAccess) return matchedPolicy.networkAccess;

  const cleanTarget = target.startsWith('fork:') ? target.slice(5) : target;
  const cmdPart = cleanTarget.split(' ')[0] || '';
  const basename = cmdPart.includes('/') ? cmdPart.split('/').pop()! : cmdPart;
  if (!NETWORK_COMMANDS.has(basename.toLowerCase())) return 'none';

  return 'proxy';
}

/**
 * Build a SandboxConfig for an approved exec operation.
 *
 * Combines sensible defaults with context-based tightening.
 * May acquire a per-run proxy for network-enabled commands.
 */
export async function buildSandboxConfig(
  deps: SeatbeltDeps,
  input: BuildSandboxInput,
): Promise<SandboxConfig> {
  const { matchedPolicy, target, effects, traceId, depth, sharedCapabilities } = input;

  const sandbox: SandboxConfig = {
    enabled: true,
    allowedReadPaths: [],
    allowedWritePaths: [],
    deniedPaths: [],
    networkAllowed: false,
    allowedHosts: [],
    allowedPorts: [],
    allowedBinaries: [],
    deniedBinaries: [],
    envInjection: {},
    envDeny: [],
    envAllow: [],
    brokerHttpPort: deps.brokerHttpPort,
  };

  // Strip NODE_OPTIONS from sandboxed children
  sandbox.envDeny.push('NODE_OPTIONS');

  // Inject trace env vars for execution chain tracking
  if (traceId) {
    sandbox.envInjection['AGENSHIELD_TRACE_ID'] = traceId;
  }
  if (depth !== undefined) {
    sandbox.envInjection['AGENSHIELD_DEPTH'] = String(depth);
  }

  // Enforce SHELL → guarded shell so parent process cannot override
  const guardedShell = `${deps.agentHome}/.agenshield/bin/guarded-shell`;
  const guardedShellExists = await nodefs.promises.access(guardedShell).then(() => true, () => false);
  if (guardedShellExists) {
    sandbox.envInjection['SHELL'] = guardedShell;
  }

  // Extract command basename early for scope filtering
  const commandBasename = target ? extractCommandBasename(target) : undefined;
  const policies = deps.getPolicies();

  // Wire concrete filesystem deny paths from policies into seatbelt profile
  const concreteDenyPaths = collectDenyPathsFromPolicies(policies, commandBasename);
  if (concreteDenyPaths.length > 0) {
    sandbox.deniedPaths.push(...concreteDenyPaths);
  }

  // Collect command-scoped filesystem allow paths
  if (commandBasename) {
    const { readPaths, writePaths } = collectAllowPathsForCommand(policies, commandBasename);
    if (readPaths.length > 0) sandbox.allowedReadPaths.push(...readPaths);
    if (writePaths.length > 0) sandbox.allowedWritePaths.push(...writePaths);
  }

  // Populate denied binaries — these must go through broker wrappers
  sandbox.deniedBinaries.push(...WRAPPER_REQUIRED_BINARIES);

  // Resolve the command binary and add to allowed binaries
  // (skip if the binary is in the denied list — it must use broker wrappers)
  if (target) {
    const cleanTarget = target.startsWith('fork:') ? target.slice(5) : target;
    const cmd = cleanTarget.split(' ')[0];
    if (cmd) {
      if (cmd.startsWith('/') && !sandbox.deniedBinaries.includes(cmd)) {
        sandbox.allowedBinaries.push(cmd);
        try {
          const realCmd = await nodefs.promises.realpath(cmd);
          if (realCmd !== cmd) sandbox.allowedBinaries.push(realCmd);
        } catch { /* command may not exist yet */ }
      }
    }
  }

  // Always allow essential binaries — resolve from agent home
  const agentHome = deps.agentHome;
  sandbox.allowedWritePaths.push(agentHome);
  sandbox.allowedBinaries.push(
    `${agentHome}/homebrew/`,
    `${agentHome}/.nvm/`,
    `${agentHome}/bin/`,
  );

  // Deny access to OpenClaw internals but allow workspace
  const openclawDir = `${agentHome}/.openclaw`;
  sandbox.deniedPaths.push(openclawDir);
  sandbox.allowedReadPaths.push(`${openclawDir}/workspace`);

  // Deny access to broker token file (defense-in-depth)
  sandbox.deniedPaths.push(`${agentHome}/.agenshield-token`);

  // Merge graph-granted filesystem paths
  if (effects) {
    if (effects.grantedFsPaths.read.length > 0) {
      sandbox.allowedReadPaths.push(...effects.grantedFsPaths.read);
    }
    if (effects.grantedFsPaths.write.length > 0) {
      sandbox.allowedWritePaths.push(...effects.grantedFsPaths.write);
    }
    // Graph-injected secrets as env vars
    if (Object.keys(effects.injectedSecrets).length > 0) {
      Object.assign(sandbox.envInjection, effects.injectedSecrets);
    }
  }

  // Merge shared capabilities from parent (via edge sharing config)
  if (sharedCapabilities) {
    if (sharedCapabilities.fsPaths.read.length > 0) {
      sandbox.allowedReadPaths.push(...sharedCapabilities.fsPaths.read);
    }
    if (sharedCapabilities.fsPaths.write.length > 0) {
      sandbox.allowedWritePaths.push(...sharedCapabilities.fsPaths.write);
    }
    // Resolve shared secrets from vault and inject
    if (sharedCapabilities.secretNames.length > 0 && deps.resolveSecrets) {
      const resolved = deps.resolveSecrets(sharedCapabilities.secretNames);
      Object.assign(sandbox.envInjection, resolved);
    }
  }

  // Determine network access mode.
  const hasGraphNetwork = effects && effects.grantedNetworkPatterns.length > 0;
  const hasSharedNetwork = sharedCapabilities && sharedCapabilities.networkPatterns.length > 0;
  const networkMode = (hasGraphNetwork || hasSharedNetwork)
    ? 'proxy'
    : determineNetworkAccess(matchedPolicy, target || '');

  if (networkMode === 'none') {
    sandbox.networkAllowed = false;
  } else if (networkMode === 'direct') {
    sandbox.networkAllowed = true;
  } else if (networkMode === 'proxy' && deps.acquireProxy) {
    const execId = crypto.randomUUID();
    const graphNetworkPatterns = effects?.grantedNetworkPatterns ?? [];
    const sharedNetworkPatterns = sharedCapabilities?.networkPatterns ?? [];
    const allGrantedPatterns = [...graphNetworkPatterns, ...sharedNetworkPatterns];

    // Build merged policy list for proxy
    const basePolicies = commandBasename
      ? filterUrlPoliciesForCommand(policies, commandBasename)
      : [];

    const proxyPolicies = allGrantedPatterns.length > 0
      ? [
          {
            id: `graph-grant-${execId.slice(0, 8)}`,
            name: 'Graph-granted network access',
            target: 'url' as const,
            action: 'allow' as const,
            patterns: allGrantedPatterns,
            enabled: true,
            priority: 999,
          },
          ...basePolicies,
        ]
      : basePolicies;

    const { port } = await deps.acquireProxy(execId, target || '', proxyPolicies, deps.defaultAction);

    sandbox.networkAllowed = true;
    sandbox.allowedHosts = ['localhost'];
    sandbox.envInjection = {
      ...sandbox.envInjection,
      HTTP_PROXY: `http://127.0.0.1:${port}`,
      HTTPS_PROXY: `http://127.0.0.1:${port}`,
      ALL_PROXY: `http://127.0.0.1:${port}`,
      http_proxy: `http://127.0.0.1:${port}`,
      https_proxy: `http://127.0.0.1:${port}`,
      all_proxy: `http://127.0.0.1:${port}`,
      NO_PROXY: 'localhost,127.0.0.1,::1,*.local,.local',
      no_proxy: 'localhost,127.0.0.1,::1,*.local,.local',
      // Ensure Node.js trusts system CA certificates through the proxy tunnel
      NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem',
      AGENSHIELD_EXEC_ID: execId,
    };
  }

  // Merge resource limits: per-policy overrides global defaults
  if (deps.resourceMonitoring?.enabled) {
    const policyLimits = matchedPolicy?.resourceLimits;
    const globalDefaults = deps.resourceMonitoring.defaults;
    if (policyLimits || globalDefaults) {
      sandbox.resourceLimits = {
        memoryMb: policyLimits?.memoryMb ?? globalDefaults?.memoryMb,
        cpuPercent: policyLimits?.cpuPercent ?? globalDefaults?.cpuPercent,
        timeoutMs: policyLimits?.timeoutMs ?? globalDefaults?.timeoutMs,
        sampleIntervalMs: policyLimits?.sampleIntervalMs ?? globalDefaults?.sampleIntervalMs,
      };
    }
  }

  return sandbox;
}

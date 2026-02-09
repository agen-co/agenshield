/**
 * Process Health Watcher
 *
 * Periodically checks broker and gateway process status via launchctl.
 * Emits lifecycle events on state transitions (started, stopped, restarted).
 */

import { execSync } from 'node:child_process';
import { emitProcessStarted, emitProcessStopped, emitProcessRestarted } from '../events/emitter';

const BROKER_LABEL = 'com.agenshield.broker';

interface ProcessState {
  running: boolean;
  pid?: number;
  lastExitStatus?: number;
}

let previousBrokerState: ProcessState = { running: false };
let previousGatewayState: ProcessState = { running: false };
let watcherInterval: NodeJS.Timeout | null = null;

// Dynamic import — openclaw-launchdaemon may not be built yet
let getOpenClawStatusSync: (() => { gateway: ProcessState }) | undefined;

async function loadIntegrations(): Promise<void> {
  try {
    const integrations = await import('@agenshield/integrations');
    getOpenClawStatusSync = (integrations as Record<string, unknown>)['getOpenClawStatusSync'] as typeof getOpenClawStatusSync;
  } catch {
    // @agenshield/integrations may not be available
  }
}

/**
 * Parse launchctl list output to extract PID and exit status.
 */
function parseLaunchctlStatus(stdout: string): ProcessState {
  const state: ProcessState = { running: false };

  const lines = stdout.split('\n');
  for (const line of lines) {
    // Try quoted format: "PID" = 1234
    const pidQuoted = line.match(/"PID"\s*=\s*(\d+)/);
    if (pidQuoted) {
      state.pid = parseInt(pidQuoted[1], 10);
      state.running = true;
    }
    const exitQuoted = line.match(/"LastExitStatus"\s*=\s*(\d+)/);
    if (exitQuoted) {
      state.lastExitStatus = parseInt(exitQuoted[1], 10);
    }

    // Try unquoted format: PID = 1234
    if (!state.pid) {
      const pidPlain = line.match(/PID\s*=\s*(\d+)/);
      if (pidPlain) {
        state.pid = parseInt(pidPlain[1], 10);
        state.running = true;
      }
    }
    if (state.lastExitStatus === undefined) {
      const exitPlain = line.match(/LastExitStatus\s*=\s*(\d+)/);
      if (exitPlain) {
        state.lastExitStatus = parseInt(exitPlain[1], 10);
      }
    }
  }

  return state;
}

/**
 * Get broker process status via launchctl.
 */
function getBrokerStatus(): ProcessState {
  try {
    const stdout = execSync(`launchctl list ${BROKER_LABEL} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseLaunchctlStatus(stdout);
  } catch {
    return { running: false };
  }
}

/**
 * Get gateway process status via @agenshield/integrations.
 */
function getGatewayStatus(): ProcessState {
  if (!getOpenClawStatusSync) return { running: false };
  try {
    const status = getOpenClawStatusSync();
    return status.gateway;
  } catch {
    return { running: false };
  }
}

/**
 * Compare previous and current state, emit lifecycle events on transitions.
 */
function emitTransitions(
  processName: 'broker' | 'gateway',
  prev: ProcessState,
  curr: ProcessState,
): void {
  if (!prev.running && curr.running) {
    // Was stopped, now running → started
    emitProcessStarted(processName, { pid: curr.pid });
  } else if (prev.running && !curr.running) {
    // Was running, now stopped → stopped
    emitProcessStopped(processName, {
      pid: prev.pid,
      lastExitStatus: curr.lastExitStatus,
    });
  } else if (prev.running && curr.running && prev.pid !== curr.pid) {
    // Was running with different PID → restarted
    emitProcessRestarted(processName, {
      pid: curr.pid,
      previousPid: prev.pid,
      lastExitStatus: curr.lastExitStatus,
    });
  }
}

/**
 * Check broker and gateway health, emit events on transitions.
 */
function checkAndEmit(): void {
  try {
    const brokerState = getBrokerStatus();
    emitTransitions('broker', previousBrokerState, brokerState);
    previousBrokerState = brokerState;
  } catch (error) {
    console.error('[process-health] Error checking broker status:', error);
  }

  try {
    const gatewayState = getGatewayStatus();
    emitTransitions('gateway', previousGatewayState, gatewayState);
    previousGatewayState = gatewayState;
  } catch (error) {
    console.error('[process-health] Error checking gateway status:', error);
  }
}

/**
 * Start the process health watcher.
 *
 * @param intervalMs - Check interval in milliseconds (default: 10 seconds)
 */
export async function startProcessHealthWatcher(intervalMs = 10000): Promise<void> {
  if (watcherInterval) {
    return; // Already running
  }

  await loadIntegrations();

  // Initial check
  checkAndEmit();

  // Start periodic checks
  watcherInterval = setInterval(checkAndEmit, intervalMs);

  console.log(`Process health watcher started (interval: ${intervalMs}ms)`);
}

/**
 * Stop the process health watcher.
 */
export function stopProcessHealthWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log('Process health watcher stopped');
  }
}

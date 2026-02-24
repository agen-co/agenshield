/**
 * Shared metrics measurement helpers.
 *
 * Extracted from routes/metrics.ts so both the live REST endpoint
 * and the background metrics collector can reuse them.
 */

import os from 'node:os';
import { execSync } from 'node:child_process';

/* ---- CPU measurement ---- */

export function cpuSnapshot(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

export async function measureCpuPercent(): Promise<number> {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 100));
  const b = cpuSnapshot();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta === 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
}

/* ---- Disk usage (df -k /) ---- */

export function getDiskPercent(): number {
  try {
    const output = execSync('df -k /', { encoding: 'utf8', timeout: 3000 });
    const lines = output.trim().split('\n');
    if (lines.length < 2) return 0;
    const match = lines[1].match(/(\d+)%/);
    if (match) return Number(match[1]);
    return 0;
  } catch {
    return 0;
  }
}

/* ---- Network throughput (delta between calls) ---- */

interface NetSnapshot {
  time: number;
  rx: number;
  tx: number;
}

let prevNet: NetSnapshot | null = null;

export function getNetworkBytes(): { rx: number; tx: number } {
  try {
    if (process.platform === 'darwin') {
      const output = execSync('netstat -ib', { encoding: 'utf8', timeout: 3000 });
      const lines = output.trim().split('\n');
      let rx = 0;
      let tx = 0;
      for (const line of lines) {
        if (line.startsWith('Name') || line.includes('lo0')) continue;
        const cols = line.split(/\s+/);
        if (cols.length >= 10) {
          const ibytes = Number(cols[6]);
          const obytes = Number(cols[9]);
          if (!isNaN(ibytes)) rx += ibytes;
          if (!isNaN(obytes)) tx += obytes;
        }
      }
      return { rx, tx };
    } else {
      const output = execSync('cat /proc/net/dev', { encoding: 'utf8', timeout: 3000 });
      const lines = output.trim().split('\n');
      let rx = 0;
      let tx = 0;
      for (const line of lines) {
        if (line.includes('lo:') || !line.includes(':')) continue;
        const parts = line.split(':')[1]?.trim().split(/\s+/);
        if (parts && parts.length >= 10) {
          rx += Number(parts[0]) || 0;
          tx += Number(parts[8]) || 0;
        }
      }
      return { rx, tx };
    }
  } catch {
    return { rx: 0, tx: 0 };
  }
}

export function getNetThroughput(): { netUp: number; netDown: number } {
  const now = Date.now();
  const current = getNetworkBytes();
  const snap: NetSnapshot = { time: now, rx: current.rx, tx: current.tx };

  if (!prevNet) {
    prevNet = snap;
    return { netUp: 0, netDown: 0 };
  }

  const dt = (now - prevNet.time) / 1000;
  if (dt <= 0) {
    prevNet = snap;
    return { netUp: 0, netDown: 0 };
  }

  const netDown = Math.round((current.rx - prevNet.rx) / dt);
  const netUp = Math.round((current.tx - prevNet.tx) / dt);
  prevNet = snap;

  return {
    netUp: Math.max(0, netUp),
    netDown: Math.max(0, netDown),
  };
}

/* ---- Active user ---- */

export function getActiveUser(): string {
  if (process.env.SUDO_USER) return process.env.SUDO_USER;
  if (process.env.LOGNAME && process.env.LOGNAME !== 'root') return process.env.LOGNAME;
  if (process.platform === 'darwin') {
    try {
      const user = execSync('stat -f %Su /dev/console', { encoding: 'utf8', timeout: 2000 }).trim();
      if (user && user !== 'root') return user;
    } catch { /* fall through */ }
  }
  return os.userInfo().username;
}

/* ---- Per-user CPU/memory measurement ---- */

export interface TargetMetricsEntry {
  targetId: string;
  targetName: string;
  cpuPercent: number;
  memPercent: number;
}

/**
 * Get aggregated CPU and memory usage for all processes owned by a given username.
 * Uses `ps -u <username> -o %cpu,%mem` and sums all rows.
 */
export function getPerUserCpuMem(username: string): { cpuPercent: number; memPercent: number } {
  try {
    const output = execSync(`ps -u ${username} -o %cpu,%mem`, {
      encoding: 'utf8',
      timeout: 3000,
    });
    const lines = output.trim().split('\n');
    let cpu = 0;
    let mem = 0;
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].trim().split(/\s+/);
      if (cols.length >= 2) {
        cpu += parseFloat(cols[0]) || 0;
        mem += parseFloat(cols[1]) || 0;
      }
    }
    return {
      cpuPercent: Math.round(cpu * 100) / 100,
      memPercent: Math.round(mem * 100) / 100,
    };
  } catch {
    return { cpuPercent: 0, memPercent: 0 };
  }
}

/**
 * Collect per-target CPU/memory metrics for all running+shielded targets.
 *
 * @param targets - Current target status list (from target watcher cache)
 * @param profiles - All profiles (for agentUsername lookup)
 */
export function collectTargetMetrics(
  targets: Array<{ id: string; name: string; shielded: boolean; running: boolean }>,
  profiles: Array<{ id: string; agentUsername?: string }>,
): TargetMetricsEntry[] {
  const results: TargetMetricsEntry[] = [];

  for (const target of targets) {
    if (!target.shielded || !target.running) continue;

    const profile = profiles.find((p) => p.id === target.id);
    const username = profile?.agentUsername;
    if (!username) continue;

    const { cpuPercent, memPercent } = getPerUserCpuMem(username);
    results.push({
      targetId: target.id,
      targetName: target.name,
      cpuPercent,
      memPercent,
    });
  }

  return results;
}

/* ---- Full snapshot builder ---- */

export interface FullMetricsSnapshot {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  activeUser: string;
  cpuModel: string;
  totalMemory: number;
  nodeVersion: string;
}

/**
 * Build a full metrics snapshot using synchronous CPU measurement.
 * Used by the collector for periodic snapshots (the async 100ms version
 * is reserved for the live REST endpoint).
 */
export function buildSyncSnapshot(): FullMetricsSnapshot {
  const snap = cpuSnapshot();
  const cpuPercent = snap.total === 0 ? 0 : Math.round((1 - snap.idle / snap.total) * 10000) / 100;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = Math.round((1 - freeMem / totalMem) * 10000) / 100;

  const diskPercent = getDiskPercent();
  const net = getNetThroughput();

  return {
    cpuPercent,
    memPercent,
    diskPercent,
    netUp: net.netUp,
    netDown: net.netDown,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(os.uptime()),
    activeUser: getActiveUser(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalMemory: totalMem,
    nodeVersion: process.version,
  };
}

/**
 * System metrics route — returns live CPU, memory, disk, and network stats.
 *
 * GET /metrics
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';

/* ---- CPU measurement (async, 100ms sample) ---- */

function cpuSnapshot(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

async function measureCpuPercent(): Promise<number> {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 100));
  const b = cpuSnapshot();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta === 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
}

/* ---- Disk usage (df -k /) ---- */

function getDiskPercent(): number {
  try {
    const output = execSync('df -k /', { encoding: 'utf8', timeout: 3000 });
    const lines = output.trim().split('\n');
    if (lines.length < 2) return 0;
    // Parse the capacity column (e.g. "45%")
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

function getNetworkBytes(): { rx: number; tx: number } {
  try {
    // macOS: netstat -ib, Linux: /proc/net/dev or ip -s link
    if (process.platform === 'darwin') {
      const output = execSync('netstat -ib', { encoding: 'utf8', timeout: 3000 });
      const lines = output.trim().split('\n');
      let rx = 0;
      let tx = 0;
      for (const line of lines) {
        // Skip header and loopback
        if (line.startsWith('Name') || line.includes('lo0')) continue;
        const cols = line.split(/\s+/);
        // netstat -ib columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
        if (cols.length >= 10) {
          const ibytes = Number(cols[6]);
          const obytes = Number(cols[9]);
          if (!isNaN(ibytes)) rx += ibytes;
          if (!isNaN(obytes)) tx += obytes;
        }
      }
      return { rx, tx };
    } else {
      // Linux: /proc/net/dev
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

function getNetThroughput(): { netUp: number; netDown: number } {
  const now = Date.now();
  const current = getNetworkBytes();
  const snap: NetSnapshot = { time: now, rx: current.rx, tx: current.tx };

  if (!prevNet) {
    prevNet = snap;
    return { netUp: 0, netDown: 0 };
  }

  const dt = (now - prevNet.time) / 1000; // seconds
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

/* ---- Route ---- */

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async () => {
    const [cpuPercent, diskPercent, net] = await Promise.all([
      measureCpuPercent(),
      Promise.resolve(getDiskPercent()),
      Promise.resolve(getNetThroughput()),
    ]);

    const total = os.totalmem();
    const free = os.freemem();
    const memPercent = Math.round((1 - free / total) * 10000) / 100;

    return {
      success: true,
      data: {
        cpuPercent,
        memPercent,
        diskPercent,
        netUp: net.netUp,
        netDown: net.netDown,
      },
    };
  });
}

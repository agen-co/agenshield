/**
 * Dummy OpenClaw Test Harness
 *
 * TypeScript types and utilities for the test harness.
 * The actual CLI is in bin/dummy-openclaw.js (plain JS for simplicity).
 */

export interface TestResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface TestResults {
  network: TestResult | null;
  file: TestResult | null;
  exec: TestResult | null;
  write: TestResult | null;
}

export interface EnvironmentStatus {
  user: string;
  uid: number | null;
  gid: number | null;
  home: string;
  cwd: string;
  path: string;
  isSandboxed: boolean;
  hasAgenshieldEnv: boolean;
  isGuardedShell: boolean;
}

/**
 * Get current environment status
 */
export function getEnvironmentStatus(): EnvironmentStatus {
  const user = process.env.USER || 'unknown';
  const shell = process.env.SHELL || '';

  return {
    user,
    uid: process.getuid?.() ?? null,
    gid: process.getgid?.() ?? null,
    home: process.env.HOME || 'unknown',
    cwd: process.cwd(),
    path: process.env.PATH || '',
    isSandboxed: user.includes('claw') || user.includes('openclaw'),
    hasAgenshieldEnv: Object.keys(process.env).some((k) => k.startsWith('AGENSHIELD_')),
    isGuardedShell: shell.includes('guarded-shell'),
  };
}

/**
 * Test network access
 */
export async function testNetwork(): Promise<TestResult> {
  const https = await import('https');

  return new Promise((resolve) => {
    const req = https.get('https://httpbin.org/get', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          success: true,
          details: {
            statusCode: res.statusCode,
            responseLength: data.length,
          },
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        success: false,
        error: e.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'timeout',
      });
    });
  });
}

/**
 * Test file read access
 */
export function testFileRead(filePath: string): TestResult {
  const fs = require('fs');

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      success: true,
      details: {
        size: content.length,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Test file write access
 */
export function testFileWrite(filePath: string): TestResult {
  const fs = require('fs');

  try {
    const content = `Test file written at ${new Date().toISOString()}\n`;
    fs.writeFileSync(filePath, content);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Test command execution
 */
export function testExec(command: string): TestResult {
  const { execSync } = require('child_process');

  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 5000 });
    return {
      success: true,
      details: {
        output: output.trim(),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
    };
  }
}

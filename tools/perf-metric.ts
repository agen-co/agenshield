/**
 * Performance metric recorder for perf test suites.
 *
 * Usage in test files:
 *   import { perf } from '../../../../tools/perf-metric';
 *   perf('storage', 'profiles.getAll', ops, '>', 2_000, 'ops/sec');
 *
 * Each call:
 * 1. Logs to console (replaces manual console.log)
 * 2. Appends a JSONL record to test-output/performance/{suite}.perf.jsonl
 * 3. Asserts the threshold via Jest expect()
 */
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PerfResult {
  suite: string;
  metric: string;
  actual: number;
  op: '>' | '<';
  threshold: number;
  unit: string;
  passed: boolean;
}

const OUT_DIR = join(process.cwd(), 'test-output', 'performance');
const initializedSuites = new Set<string>();

export function perf(
  suite: string,
  metric: string,
  actual: number,
  op: '>' | '<',
  threshold: number,
  unit: string,
): void {
  const filePath = join(OUT_DIR, `${suite}.perf.jsonl`);

  if (!initializedSuites.has(suite)) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(filePath, '');
    initializedSuites.add(suite);
  }

  const passed = op === '>' ? actual > threshold : actual < threshold;
  const result: PerfResult = { suite, metric, actual, op, threshold, unit, passed };
  appendFileSync(filePath, JSON.stringify(result) + '\n');

  const icon = passed ? '✅' : '❌';
  const formatted =
    unit === 'ms'
      ? actual.toFixed(1)
      : unit === 'x'
        ? actual.toFixed(1)
        : Math.round(actual).toLocaleString();
  console.log(`  ${icon} ${metric}: ${formatted} ${unit} (threshold: ${op} ${threshold} ${unit})`);

  if (op === '>') expect(actual).toBeGreaterThan(threshold);
  else expect(actual).toBeLessThan(threshold);
}

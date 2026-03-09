import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface MetricDetail {
  total: number;
  covered: number;
  pct: number | string;
}

interface CoverageTotals {
  statements: MetricDetail;
  branches: MetricDetail;
  functions: MetricDetail;
  lines: MetricDetail;
}

interface PerfResult {
  suite: string;
  metric: string;
  actual: number;
  op: '>' | '<';
  threshold: number;
  unit: string;
  passed: boolean;
}

const ROOT = join(__dirname, '..');
const COVERAGE_DIR = join(ROOT, 'test-output', 'coverage', 'libs');
const PERF_DIR = join(ROOT, 'test-output', 'performance');
const OUT_DIR = join(ROOT, 'test-output');
const covMetrics: (keyof CoverageTotals)[] = ['statements', 'branches', 'functions', 'lines'];

function indicator(pct: number): string {
  if (pct >= 90) return '🟢';
  if (pct >= 70) return '🟡';
  return '🔴';
}

function numPct(pct: number | string): number {
  return typeof pct === 'number' ? pct : 0;
}

function fmt(pct: number | string): string {
  const n = numPct(pct);
  return `${indicator(n)} ${n.toFixed(2)}%`;
}

function fmtBold(pct: number): string {
  return `${indicator(pct)} **${pct.toFixed(2)}%**`;
}

function weightedPct(entries: CoverageTotals[], key: keyof CoverageTotals): number {
  let totalCount = 0;
  let coveredCount = 0;
  for (const e of entries) {
    totalCount += e[key].total;
    coveredCount += e[key].covered;
  }
  return totalCount === 0 ? 100 : (coveredCount / totalCount) * 100;
}

function scanCoverage(dir: string): { name: string; totals: CoverageTotals }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((lib) => {
      const file = join(dir, lib, 'coverage-summary.json');
      if (!existsSync(file)) return [];
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      return data.total ? [{ name: lib, totals: data.total as CoverageTotals }] : [];
    });
}

function renderTable(title: string, entries: { name: string; totals: CoverageTotals }[]): string[] {
  const lines: string[] = [];
  lines.push(`## ${title}\n`);
  lines.push('| Library | Stmts | Branch | Funcs | Lines |');
  lines.push('|---------|-------|--------|-------|-------|');
  for (const { name, totals } of entries) {
    const cols = covMetrics.map((m) => fmt(totals[m].pct));
    lines.push(`| ${name} | ${cols.join(' | ')} |`);
  }
  const allTotals = entries.map((e) => e.totals);
  const weightedCols = covMetrics.map((m) => fmtBold(weightedPct(allTotals, m)));
  lines.push(`| **Total** | ${weightedCols.join(' | ')} |`);
  return lines;
}

function scanPerfResults(dir: string): Map<string, PerfResult[]> {
  const suites = new Map<string, PerfResult[]>();
  if (!existsSync(dir)) return suites;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.perf.jsonl')) continue;
    const content = readFileSync(join(dir, file), 'utf-8').trim();
    if (!content) continue;
    for (const line of content.split('\n')) {
      const r = JSON.parse(line) as PerfResult;
      if (!suites.has(r.suite)) suites.set(r.suite, []);
      suites.get(r.suite)!.push(r);
    }
  }
  return suites;
}

function fmtActual(r: PerfResult): string {
  if (r.unit === 'ms') return `${r.actual.toFixed(1)} ms`;
  if (r.unit === 'x') return `${r.actual.toFixed(1)}x`;
  return `${Math.round(r.actual).toLocaleString()} ${r.unit}`;
}

function fmtThreshold(r: PerfResult): string {
  if (r.unit === 'ms') return `${r.op} ${r.threshold} ms`;
  if (r.unit === 'x') return `${r.op} ${r.threshold}x`;
  return `${r.op} ${r.threshold.toLocaleString()} ${r.unit}`;
}

function renderPerfTable(suites: Map<string, PerfResult[]>): string[] {
  const lines: string[] = [];
  const sortedSuites = [...suites.keys()].sort();
  let totalTests = 0;
  let passedTests = 0;

  for (const suite of sortedSuites) {
    const results = suites.get(suite)!;
    lines.push(`### ${suite}\n`);
    lines.push('| Metric | Actual | Threshold | Status |');
    lines.push('|--------|--------|-----------|--------|');
    for (const r of results) {
      const status = r.passed ? '✅' : '❌';
      lines.push(`| ${r.metric} | ${fmtActual(r)} | ${fmtThreshold(r)} | ${status} |`);
      totalTests++;
      if (r.passed) passedTests++;
    }
    lines.push('');
  }

  const pct = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(0) : '0';
  lines.push(`**${passedTests}/${totalTests} passed (${pct}%)**`);
  return lines;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const unitEntries = scanCoverage(COVERAGE_DIR);
const perfResults = scanPerfResults(PERF_DIR);

if (unitEntries.length === 0 && perfResults.size === 0) {
  console.error('No coverage or performance data found. Run "yarn test --coverage" first.');
  process.exit(1);
}

const lines: string[] = [];

if (unitEntries.length > 0) {
  lines.push(...renderTable('Coverage Report', unitEntries));
}

if (perfResults.size > 0) {
  if (lines.length > 0) lines.push('', '---', '');
  lines.push('## Performance Tests\n');
  lines.push(...renderPerfTable(perfResults));
}

const output = lines.join('\n') + '\n';
console.log(output);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'coverage-report.md'), output);
console.log(`Written to test-output/coverage-report.md`);

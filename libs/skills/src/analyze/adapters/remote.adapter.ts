/**
 * RemoteAnalyzeAdapter — AI-powered security analysis via skills.agentfront.dev
 *
 * POSTs skill files to the remote analyzer (OpenAI gpt-5-mini), parses the
 * NDJSON response stream, and maps the aggregated summary to AnalysisResult.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillVersion, SkillFile, AnalysisResult } from '@agenshield/ipc';
import type { AnalyzeAdapter } from '../types';
import { AnalysisError } from '../../errors';

const DEFAULT_BASE_URL = 'https://skills.agentfront.dev';
const DEFAULT_TIMEOUT = 4 * 60_000; // 4 minutes
const MAX_FILE_SIZE = 100 * 1024; // 100 KB per file
const MAX_FILES = 20;

export interface RemoteAnalyzeAdapterOptions {
  /** Base URL for the analyzer API. Default: https://skills.agentfront.dev */
  baseUrl?: string;
  /** Request timeout in ms. Default: 240_000 (4 min) */
  timeout?: number;
  /** Bypass upstream cache. Default: false */
  noCache?: boolean;
}

const EXT_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.txt': 'text/plain',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.cfg': 'text/plain',
  '.ini': 'text/plain',
  '.env': 'text/plain',
};

function mimeFromExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? 'text/plain';
}

/** Shape of the upstream NDJSON 'done' event data */
interface AnalysisSummary {
  status: 'complete' | 'error';
  vulnerability: { level: string; details: string[]; suggestions?: string[] };
  commands: Array<{ name: string; source: string; available: boolean; required: boolean }>;
  envVariables?: Array<{ name: string; required: boolean; purpose: string; sensitive: boolean }>;
  runtimeRequirements?: Array<{ runtime: string; minVersion?: string; reason: string }>;
  installationSteps?: Array<{ command: string; packageManager: string; required: boolean; description: string }>;
  runCommands?: Array<{ command: string; description: string; entrypoint: boolean }>;
  securityFindings?: Array<{ severity: string; category: string; cwe?: string; owaspCategory?: string; description: string; evidence?: string }>;
  mcpSpecificRisks?: Array<{ riskType: string; description: string; severity: string }>;
}

/**
 * Parse an NDJSON response stream, extracting the 'done' event data.
 */
async function parseNdjsonStream(res: Response): Promise<AnalysisSummary> {
  const reader = res.body?.getReader();
  if (!reader) throw new AnalysisError('No response body from remote analyzer');

  const decoder = new TextDecoder();
  let buffer = '';
  let summary: AnalysisSummary | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { type: string; data: unknown };
        if (event.type === 'done') {
          summary = event.data as AnalysisSummary;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as { type: string; data: unknown };
      if (event.type === 'done') {
        summary = event.data as AnalysisSummary;
      }
    } catch {
      // Skip malformed line
    }
  }

  if (!summary) throw new AnalysisError('No summary received from remote analyzer');
  return summary;
}

function mapSummaryToResult(summary: AnalysisSummary): AnalysisResult {
  const level = summary.vulnerability?.level ?? 'safe';
  const status: AnalysisResult['status'] =
    level === 'critical' || level === 'high' ? 'error' : 'success';

  return {
    status,
    requiredBins: summary.commands?.filter((c) => c.required).map((c) => c.name) ?? [],
    requiredEnv: summary.envVariables?.filter((e) => e.required).map((e) => e.name) ?? [],
    extractedCommands: summary.runCommands?.map((c) => c.command) ?? [],
    data: {
      vulnerability: summary.vulnerability,
      commands: summary.commands,
      envVariables: summary.envVariables,
      runtimeRequirements: summary.runtimeRequirements,
      installationSteps: summary.installationSteps,
      runCommands: summary.runCommands,
      securityFindings: summary.securityFindings,
      mcpSpecificRisks: summary.mcpSpecificRisks,
    },
  };
}

export class RemoteAnalyzeAdapter implements AnalyzeAdapter {
  readonly id = 'remote';
  readonly displayName = 'Remote Security Analyzer';

  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly noCache: boolean;

  constructor(options?: RemoteAnalyzeAdapterOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    this.noCache = options?.noCache ?? false;
  }

  async analyze(version: SkillVersion, files: SkillFile[]): Promise<AnalysisResult> {
    try {
      const payload = this.buildPayload(version, files);
      if (payload.files.length === 0) {
        return {
          status: 'error',
          error: 'No readable files found for remote analysis',
          data: null,
          requiredBins: [],
          requiredEnv: [],
          extractedCommands: [],
        };
      }

      const res = await fetch(`${this.baseUrl}/api/analyze`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AnalysisError(`Remote analyzer returned ${res.status}: ${text}`, res.status);
      }

      const summary = await parseNdjsonStream(res);
      return mapSummaryToResult(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        error: msg,
        data: null,
        requiredBins: [],
        requiredEnv: [],
        extractedCommands: [],
      };
    }
  }

  private buildPayload(
    version: SkillVersion,
    files: SkillFile[],
  ): { files: Array<{ name: string; type: string; content: string }>; skillName: string; noCache?: boolean } {
    const slugParts = version.folderPath.split(path.sep);
    const skillName = slugParts[slugParts.length - 2] ?? 'unknown';

    const readableFiles: Array<{ name: string; type: string; content: string }> = [];

    for (const file of files.slice(0, MAX_FILES)) {
      try {
        const filePath = path.join(version.folderPath, file.relativePath);
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(file.relativePath);
        readableFiles.push({
          name: file.relativePath,
          type: mimeFromExt(ext),
          content,
        });
      } catch {
        // Skip files that can't be read (binary, missing, permission errors)
      }
    }

    return {
      files: readableFiles,
      skillName,
      ...(this.noCache ? { noCache: true } : {}),
    };
  }
}

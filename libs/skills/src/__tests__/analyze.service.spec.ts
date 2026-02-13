/**
 * AnalyzeService + BasicAnalyzeAdapter + RemoteAnalyzeAdapter tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { AnalyzeService } from '../analyze/analyze.service';
import { BasicAnalyzeAdapter } from '../analyze/adapters/basic.adapter';
import { RemoteAnalyzeAdapter } from '../analyze/adapters/remote.adapter';
import type { AnalyzeAdapter } from '../analyze/types';
import type { SkillEvent } from '../events';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  new SkillsManagerColumnsMigration().up(db);
  return { db, cleanup: () => { db.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
}

describe('BasicAnalyzeAdapter', () => {
  const adapter = new BasicAnalyzeAdapter();

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('basic');
    expect(adapter.displayName).toBe('Basic Analyzer');
  });

  it('returns success with file count', () => {
    const version = {
      id: 'v1', skillId: 's1', version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown' as const, trusted: false,
      analysisStatus: 'pending' as const,
      requiredBins: ['node'], requiredEnv: ['API_KEY'],
      extractedCommands: [], createdAt: '', updatedAt: '',
    };
    const files = [
      { id: 'f1', skillVersionId: 'v1', relativePath: 'index.ts', fileHash: 'h1', sizeBytes: 100, createdAt: '', updatedAt: '' },
      { id: 'f2', skillVersionId: 'v1', relativePath: 'SKILL.md', fileHash: 'h2', sizeBytes: 50, createdAt: '', updatedAt: '' },
    ];

    const result = adapter.analyze(version, files);

    expect(result.status).toBe('success');
    expect(result.requiredBins).toContain('node');
    expect(result.requiredEnv).toContain('API_KEY');
    expect((result.data as Record<string, unknown>).hasManifest).toBe(true);
    expect((result.data as Record<string, unknown>).fileCount).toBe(2);
  });

  it('extracts from metadataJson', () => {
    const version = {
      id: 'v1', skillId: 's1', version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown' as const, trusted: false,
      analysisStatus: 'pending' as const,
      requiredBins: [], requiredEnv: [], extractedCommands: [],
      metadataJson: { requiredBins: ['python3'], commands: ['pip install'] },
      createdAt: '', updatedAt: '',
    };

    const result = adapter.analyze(version, []);
    expect(result.requiredBins).toContain('python3');
    expect(result.extractedCommands).toContain('pip install');
  });
});

describe('AnalyzeService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let service: AnalyzeService;
  let events: SkillEvent[];

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
    service = new AnalyzeService(repo, [new BasicAnalyzeAdapter()], emitter);
  });

  afterEach(() => cleanup());

  it('analyzeVersion performs analysis and persists result', async () => {
    const skill = repo.create({ name: 'S', slug: 's-test', tags: [], source: 'manual' });
    const v = repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });
    repo.registerFiles({ versionId: v.id, files: [
      { relativePath: 'index.ts', fileHash: 'h1', sizeBytes: 100 },
    ] });

    const result = await service.analyzeVersion(v.id);

    expect(result.status).toBe('success');
    expect(events.some((e) => e.type === 'analyze:completed')).toBe(true);

    // Check persisted
    const updated = repo.getVersionById(v.id)!;
    expect(updated.analysisStatus).toBe('complete');
    expect(updated.analyzedAt).toBeDefined();
  });

  it('analyzeVersion throws for non-existent', async () => {
    await expect(service.analyzeVersion('non-existent')).rejects.toThrow();
    expect(events.some((e) => e.type === 'analyze:error')).toBe(true);
  });

  it('analyzePending processes pending versions', async () => {
    const skill = repo.create({ name: 'S', slug: 's-pending', tags: [], source: 'manual' });
    repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });

    const results = await service.analyzePending();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('reanalyze resets and re-analyzes', async () => {
    const skill = repo.create({ name: 'S', slug: 's-reana', tags: [], source: 'manual' });
    const v = repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'complete',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });

    const result = await service.reanalyze(v.id);
    expect(result.status).toBe('success');
  });

  it('merges results from multiple adapters', async () => {
    const warningAdapter: AnalyzeAdapter = {
      id: 'warning-adapter',
      displayName: 'Warning Adapter',
      analyze: () => ({
        status: 'warning',
        data: { flagged: true },
        requiredBins: ['docker'],
        requiredEnv: ['DOCKER_HOST'],
        extractedCommands: ['docker run'],
      }),
    };

    const multiService = new AnalyzeService(repo, [new BasicAnalyzeAdapter(), warningAdapter], emitter);

    const skill = repo.create({ name: 'S', slug: 's-multi', tags: [], source: 'manual' });
    const v = repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: ['node'], requiredEnv: [], extractedCommands: [],
    });
    repo.registerFiles({ versionId: v.id, files: [
      { relativePath: 'SKILL.md', fileHash: 'h1', sizeBytes: 50 },
    ] });

    const result = await multiService.analyzeVersion(v.id);

    // Worst-wins: warning > success
    expect(result.status).toBe('warning');

    // Union of bins/env/commands
    expect(result.requiredBins).toContain('node');
    expect(result.requiredBins).toContain('docker');
    expect(result.requiredEnv).toContain('DOCKER_HOST');
    expect(result.extractedCommands).toContain('docker run');

    // Merged data keyed by adapter ID
    const data = result.data as Record<string, unknown>;
    expect(data['basic']).toBeDefined();
    expect(data['warning-adapter']).toBeDefined();
    expect((data['warning-adapter'] as Record<string, unknown>).flagged).toBe(true);
  });
});

describe('RemoteAnalyzeAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchWithNdjson(summary: Record<string, unknown>, status = 200) {
    const ndjson = [
      JSON.stringify({ type: 'progress', data: { step: 'analyzing' } }),
      JSON.stringify({ type: 'done', data: summary }),
    ].join('\n');

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjson));
        controller.close();
      },
    });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      body,
      text: () => Promise.resolve(ndjson),
    });
  }

  it('has correct id and displayName', () => {
    const adapter = new RemoteAnalyzeAdapter();
    expect(adapter.id).toBe('remote');
    expect(adapter.displayName).toBe('Remote Security Analyzer');
  });

  it('parses NDJSON stream and maps to AnalysisResult', async () => {
    const summary = {
      status: 'complete',
      vulnerability: { level: 'medium', details: ['Potential XSS'], suggestions: ['Sanitize inputs'] },
      commands: [
        { name: 'node', source: 'package.json', available: true, required: true },
        { name: 'curl', source: 'script.sh', available: true, required: false },
      ],
      envVariables: [
        { name: 'API_KEY', required: true, purpose: 'Auth', sensitive: true },
        { name: 'DEBUG', required: false, purpose: 'Logging', sensitive: false },
      ],
      runCommands: [
        { command: 'node index.js', description: 'Start server', entrypoint: true },
      ],
      securityFindings: [
        { severity: 'medium', category: 'xss', description: 'Potential XSS' },
      ],
      mcpSpecificRisks: [],
    };

    mockFetchWithNdjson(summary);

    // Create a temp dir with a file
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-test-'));
    fs.writeFileSync(path.join(dir, 'index.ts'), 'console.log("hello")');

    const adapter = new RemoteAnalyzeAdapter({ baseUrl: 'https://test.example.com' });
    const result = await adapter.analyze(
      {
        id: 'v1', skillId: 's1', version: '1.0.0', folderPath: dir,
        contentHash: 'abc', hashUpdatedAt: '', approval: 'unknown', trusted: false,
        analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [],
        createdAt: '', updatedAt: '',
      },
      [{ id: 'f1', skillVersionId: 'v1', relativePath: 'index.ts', fileHash: 'h1', sizeBytes: 20, createdAt: '', updatedAt: '' }],
    );

    // Not critical/high → success
    expect(result.status).toBe('success');
    expect(result.requiredBins).toEqual(['node']);
    expect(result.requiredEnv).toEqual(['API_KEY']);
    expect(result.extractedCommands).toEqual(['node index.js']);
    expect((result.data as Record<string, unknown>).vulnerability).toEqual(summary.vulnerability);

    // Verify fetch was called correctly
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://test.example.com/api/analyze',
      expect.objectContaining({ method: 'POST' }),
    );

    fs.rmSync(dir, { recursive: true });
  });

  it('maps critical/high vulnerability to error status', async () => {
    const summary = {
      status: 'complete',
      vulnerability: { level: 'critical', details: ['RCE found'] },
      commands: [],
      envVariables: [],
      runCommands: [],
    };

    mockFetchWithNdjson(summary);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-test-'));
    fs.writeFileSync(path.join(dir, 'script.sh'), '#!/bin/bash\nrm -rf /');

    const adapter = new RemoteAnalyzeAdapter({ baseUrl: 'https://test.example.com' });
    const result = await adapter.analyze(
      {
        id: 'v1', skillId: 's1', version: '1.0.0', folderPath: dir,
        contentHash: 'abc', hashUpdatedAt: '', approval: 'unknown', trusted: false,
        analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [],
        createdAt: '', updatedAt: '',
      },
      [{ id: 'f1', skillVersionId: 'v1', relativePath: 'script.sh', fileHash: 'h1', sizeBytes: 30, createdAt: '', updatedAt: '' }],
    );

    expect(result.status).toBe('error');
    fs.rmSync(dir, { recursive: true });
  });

  it('returns error result on fetch failure', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-test-'));
    fs.writeFileSync(path.join(dir, 'index.ts'), 'code');

    const adapter = new RemoteAnalyzeAdapter({ baseUrl: 'https://test.example.com' });
    const result = await adapter.analyze(
      {
        id: 'v1', skillId: 's1', version: '1.0.0', folderPath: dir,
        contentHash: 'abc', hashUpdatedAt: '', approval: 'unknown', trusted: false,
        analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [],
        createdAt: '', updatedAt: '',
      },
      [{ id: 'f1', skillVersionId: 'v1', relativePath: 'index.ts', fileHash: 'h1', sizeBytes: 4, createdAt: '', updatedAt: '' }],
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Network down');
    fs.rmSync(dir, { recursive: true });
  });

  it('returns error when no readable files', async () => {
    const adapter = new RemoteAnalyzeAdapter();
    const result = await adapter.analyze(
      {
        id: 'v1', skillId: 's1', version: '1.0.0', folderPath: '/nonexistent/path',
        contentHash: 'abc', hashUpdatedAt: '', approval: 'unknown', trusted: false,
        analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [],
        createdAt: '', updatedAt: '',
      },
      [{ id: 'f1', skillVersionId: 'v1', relativePath: 'missing.ts', fileHash: 'h1', sizeBytes: 10, createdAt: '', updatedAt: '' }],
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('No readable files');
  });

  it('sends noCache flag when configured', async () => {
    const summary = {
      status: 'complete',
      vulnerability: { level: 'safe', details: [] },
      commands: [],
    };
    mockFetchWithNdjson(summary);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-test-'));
    fs.writeFileSync(path.join(dir, 'index.ts'), 'code');

    const adapter = new RemoteAnalyzeAdapter({ baseUrl: 'https://test.example.com', noCache: true });
    await adapter.analyze(
      {
        id: 'v1', skillId: 's1', version: '1.0.0', folderPath: dir,
        contentHash: 'abc', hashUpdatedAt: '', approval: 'unknown', trusted: false,
        analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [],
        createdAt: '', updatedAt: '',
      },
      [{ id: 'f1', skillVersionId: 'v1', relativePath: 'index.ts', fileHash: 'h1', sizeBytes: 4, createdAt: '', updatedAt: '' }],
    );

    const call = (globalThis.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.noCache).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });
});

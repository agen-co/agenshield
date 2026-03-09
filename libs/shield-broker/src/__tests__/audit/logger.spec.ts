import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AuditLogger } from '../../audit/logger.js';
import type { AuditEntry } from '../../types.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'broker-audit-test-'));
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'test-1',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    operation: 'exec' as any,
    channel: 'socket',
    allowed: true,
    target: 'node server.js',
    result: 'success',
    durationMs: 10,
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    logPath = path.join(tmpDir, 'audit.log');
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(async () => {
    // Allow any pending stream operations to complete before cleanup
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe('log()', () => {
    it('should write JSON lines to log file', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry());
      await logger.close();

      const content = fs.readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.id).toBe('test-1');
      expect(parsed.operation).toBe('exec');
    });

    it('should serialize timestamp to ISO string', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ timestamp: new Date('2025-06-15T12:00:00Z') }));
      await logger.close();

      const content = fs.readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.timestamp).toBe('2025-06-15T12:00:00.000Z');
    });

    it('should write multiple entries as separate lines', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ id: 'entry-1' }));
      await logger.log(makeEntry({ id: 'entry-2' }));
      await logger.close();

      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('maybeRotate()', () => {
    it('should rotate when file exceeds maxFileSize', async () => {
      // Pre-populate file so that it already exceeds maxFileSize when the logger reads it.
      // createWriteStream opens asynchronously, so relying on writes alone to trigger
      // rotation is unreliable; pre-populating ensures existsSync/statSync see the data.
      const line = JSON.stringify(makeEntry()) + '\n';
      fs.writeFileSync(logPath, line.repeat(5)); // ~1000 bytes, well over 100

      const logger = new AuditLogger({ logPath, logLevel: 'error', maxFileSize: 100, maxFiles: 3 });
      // Constructor reads file size via statSync → currentSize > maxFileSize.
      // The first log() call triggers maybeRotate which renames the existing file.
      await logger.log(makeEntry({ id: 'trigger' }));
      await logger.close();

      // After rotation, .1 file should exist
      expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    });
  });

  describe('query()', () => {
    it('should return entries from log file', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ id: 'q1' }));
      await logger.log(makeEntry({ id: 'q2' }));
      await logger.close();

      const results = await logger.query({});
      expect(results.length).toBe(2);
    });

    it('should filter by operation', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ id: 'q1', operation: 'exec' as any }));
      await logger.log(makeEntry({ id: 'q2', operation: 'file_read' as any }));
      await logger.close();

      const results = await logger.query({ operation: 'exec' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('q1');
    });

    it('should filter by allowed', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ id: 'q1', allowed: true }));
      await logger.log(makeEntry({ id: 'q2', allowed: false }));
      await logger.close();

      const results = await logger.query({ allowed: false });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('q2');
    });

    it('should respect limit', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      for (let i = 0; i < 10; i++) {
        await logger.log(makeEntry({ id: `q${i}` }));
      }
      await logger.close();

      const results = await logger.query({ limit: 3 });
      expect(results.length).toBe(3);
    });

    it('should return entries in reverse order (most recent first)', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ id: 'first' }));
      await logger.log(makeEntry({ id: 'second' }));
      await logger.close();

      const results = await logger.query({});
      expect(results[0].id).toBe('second');
      expect(results[1].id).toBe('first');
    });

    it('should return empty array when log file does not exist', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      // Remove the log file created by constructor, then query
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      const results = await logger.query({});
      expect(results).toEqual([]);
      await logger.close();
    });

    it('should handle malformed log lines gracefully', async () => {
      fs.writeFileSync(logPath, 'not json\n{"id":"valid","timestamp":"2025-01-01T00:00:00Z","operation":"exec","channel":"socket","allowed":true,"target":"test","result":"success","durationMs":0}\n');
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      const results = await logger.query({});
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('valid');
      await logger.close();
    });
  });

  describe('close()', () => {
    it('should close write stream', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.close();
      // Should not throw on double close
      await logger.close();
    });
  });

  describe('shouldLog()', () => {
    it('error level should only log errors to console', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      await logger.log(makeEntry({ allowed: true })); // info level
      expect(console.info).not.toHaveBeenCalled();
      await logger.close();
    });

    it('info level should log info to console', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'info' });
      await logger.log(makeEntry({ allowed: true })); // info level
      expect(console.info).toHaveBeenCalled();
      await logger.close();
    });
  });

  describe('initializeStream()', () => {
    it('should create directory when parent does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'sub', 'dir');
      const nestedLogPath = path.join(nestedDir, 'audit.log');
      const logger = new AuditLogger({ logPath: nestedLogPath, logLevel: 'error' });
      expect(fs.existsSync(nestedDir)).toBe(true);
      await logger.close();
    });
  });

  describe('rotation', () => {
    it('should rename .1 to .2 and delete oldest at maxFiles', async () => {
      // Pre-create rotated files
      const line = JSON.stringify(makeEntry()) + '\n';
      fs.writeFileSync(logPath, line.repeat(20)); // large enough
      fs.writeFileSync(`${logPath}.1`, 'old-1\n');
      fs.writeFileSync(`${logPath}.2`, 'old-2\n');

      const logger = new AuditLogger({ logPath, logLevel: 'error', maxFileSize: 100, maxFiles: 3 });
      await logger.log(makeEntry({ id: 'rotate-trigger' }));
      await logger.close();

      // .2 should have been deleted (was maxFiles-1=2), .1 should be renamed to .2
      expect(fs.existsSync(`${logPath}.2`)).toBe(true);
      // The old .2 should have been deleted and replaced by old .1
      const content2 = fs.readFileSync(`${logPath}.2`, 'utf-8');
      expect(content2).toBe('old-1\n');
    });
  });

  describe('console logging for denied entries', () => {
    it('should call console.warn for denied entries at warn level', async () => {
      const logger = new AuditLogger({ logPath, logLevel: 'warn' });
      await logger.log(makeEntry({ allowed: false, target: 'suspicious' }));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('✗'));
      await logger.close();
    });
  });

  describe('helper methods', () => {
    it('debug() should log when logLevel is debug', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const logger = new AuditLogger({ logPath, logLevel: 'debug' });
      logger.debug('test message', { key: 'val' });
      expect(debugSpy).toHaveBeenCalledWith('[DEBUG] test message', { key: 'val' });
      debugSpy.mockRestore();
      logger.close();
    });

    it('debug() should NOT log when logLevel is error', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      logger.debug('test message');
      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
      logger.close();
    });

    it('info() should log when logLevel is info', () => {
      const logger = new AuditLogger({ logPath, logLevel: 'info' });
      logger.info('info message');
      expect(console.info).toHaveBeenCalledWith('[INFO] info message', '');
      logger.close();
    });

    it('warn() should log when logLevel is warn', () => {
      const logger = new AuditLogger({ logPath, logLevel: 'warn' });
      logger.warn('warn message');
      expect(console.warn).toHaveBeenCalledWith('[WARN] warn message', '');
      logger.close();
    });

    it('error() should log when logLevel is error', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const logger = new AuditLogger({ logPath, logLevel: 'error' });
      logger.error('error message', { detail: 'x' });
      expect(errorSpy).toHaveBeenCalledWith('[ERROR] error message', { detail: 'x' });
      errorSpy.mockRestore();
      logger.close();
    });
  });
});

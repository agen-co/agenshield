import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Partial mock: keep real implementations but allow overriding specific methods
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return {
    ...actual,
    readFile: jest.fn(actual.readFile),
    readdir: jest.fn(actual.readdir),
  };
});

import * as fsp from 'node:fs/promises';
import { handleFileRead, handleFileWrite, handleFileList } from '../../handlers/file.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

const ctx = createHandlerContext();
const deps = createMockDeps();

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'broker-file-test-'));
}

describe('handleFileRead', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return error 1003 when path is missing', async () => {
    const result = await handleFileRead({}, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1005 when file does not exist', async () => {
    const result = await handleFileRead({ path: path.join(tmpDir, 'nope.txt') }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
  });

  it('should return error 1005 when path is a directory', async () => {
    const result = await handleFileRead({ path: tmpDir }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
  });

  it('should return content, size, mtime for valid file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    const result = await handleFileRead({ path: filePath }, ctx, deps);
    expect(result.success).toBe(true);
    expect(result.data!.content).toBe('hello');
    expect(result.data!.size).toBe(5);
    expect(result.data!.mtime).toBeDefined();
  });

  it('should return error 1005 when readFile throws unexpectedly (outer catch)', async () => {
    const filePath = path.join(tmpDir, 'test-catch.txt');
    fs.writeFileSync(filePath, 'content');

    // Override the mocked readFile to throw once
    (fsp.readFile as jest.Mock).mockRejectedValueOnce(new Error('Unexpected I/O error'));

    const result = await handleFileRead({ path: filePath }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
    expect(result.error!.message).toContain('File read error');
  });
});

describe('handleFileWrite', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return error 1003 when path is missing', async () => {
    const result = await handleFileWrite({ content: 'test' }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1003 when content is undefined', async () => {
    const result = await handleFileWrite({ path: path.join(tmpDir, 'file.txt') }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should create parent directories and write content', async () => {
    const filePath = path.join(tmpDir, 'sub', 'dir', 'file.txt');
    const result = await handleFileWrite({ path: filePath, content: 'hello' }, ctx, deps);
    expect(result.success).toBe(true);
    expect(result.data!.bytesWritten).toBe(5);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
  });

  it('should return error 1005 when writeFile throws', async () => {
    // Writing to a path where parent is a file (not a directory) will cause mkdir to fail
    const blockingFile = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blockingFile, 'x');
    // Try to write to blocker/sub/file.txt — mkdir will fail because 'blocker' is a file
    const filePath = path.join(blockingFile, 'sub', 'file.txt');
    const result = await handleFileWrite({ path: filePath, content: 'data' }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
    expect(result.error!.message).toContain('File write error');
  });
});

describe('handleFileList', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return error 1003 when path is missing', async () => {
    const result = await handleFileList({}, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1005 when directory does not exist', async () => {
    const result = await handleFileList({ path: path.join(tmpDir, 'nope') }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
  });

  it('should return error 1005 when path is not a directory', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    const result = await handleFileList({ path: filePath }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
  });

  it('should list files with name, path, type, size', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));

    const result = await handleFileList({ path: tmpDir }, ctx, deps);
    expect(result.success).toBe(true);

    const entries = result.data!.entries;
    expect(entries.length).toBe(2);

    const file = entries.find((e) => e.name === 'a.txt');
    expect(file).toBeDefined();
    expect(file!.type).toBe('file');
    expect(file!.size).toBe(5);

    const dir = entries.find((e) => e.name === 'subdir');
    expect(dir).toBeDefined();
    expect(dir!.type).toBe('directory');
  });

  it('should support pattern filtering', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'test.js'), 'x');

    const result = await handleFileList({ path: tmpDir, pattern: '*.ts' }, ctx, deps);
    expect(result.success).toBe(true);
    expect(result.data!.entries).toHaveLength(1);
    expect(result.data!.entries[0].name).toBe('test.ts');
  });

  it('should list entries recursively', async () => {
    const subDir = path.join(tmpDir, 'a');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'deep.txt'), 'content');
    fs.writeFileSync(path.join(tmpDir, 'top.txt'), 'content');

    const result = await handleFileList({ path: tmpDir, recursive: true }, ctx, deps);
    expect(result.success).toBe(true);

    const names = result.data!.entries.map((e) => e.name);
    expect(names).toContain('top.txt');
    expect(names).toContain('deep.txt');
    expect(names).toContain('a');
  });

  it('should return error 1005 when readdir throws unexpectedly (outer catch)', async () => {
    // Override the mocked readdir to throw once
    (fsp.readdir as jest.Mock).mockRejectedValueOnce(new Error('Unexpected readdir error'));

    const result = await handleFileList({ path: tmpDir }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1005);
    expect(result.error!.message).toContain('File list error');
  });
});

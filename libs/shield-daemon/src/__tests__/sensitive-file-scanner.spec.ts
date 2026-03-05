import { scanForSensitiveFiles } from '../services/sensitive-file-scanner';
import * as fs from 'node:fs';

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readdirSync: jest.fn(),
}));

const mockReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;

function dirent(name: string, isDir: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as fs.Dirent;
}

describe('scanForSensitiveFiles', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('detects .env file', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir) === '/ws') {
        return [dirent('.env', false), dirent('index.ts', false)] as any;
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toEqual([
      { path: '/ws/.env', reason: 'sensitive filename: .env' },
    ]);
  });

  it('detects multiple .env variants', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir) === '/ws') {
        return [
          dirent('.env', false),
          dirent('.env.local', false),
          dirent('.env.production', false),
        ] as any;
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.path)).toEqual([
      '/ws/.env',
      '/ws/.env.local',
      '/ws/.env.production',
    ]);
  });

  it('detects .pem and .key files', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir) === '/ws') {
        return [
          dirent('server.pem', false),
          dirent('private.key', false),
          dirent('cert.PFX', false),
          dirent('readme.md', false),
        ] as any;
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.path)).toContain('/ws/server.pem');
    expect(result.map(r => r.path)).toContain('/ws/private.key');
    expect(result.map(r => r.path)).toContain('/ws/cert.PFX');
  });

  it('detects credentials.json and id_rsa', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir) === '/ws') {
        return [
          dirent('credentials.json', false),
          dirent('id_rsa', false),
          dirent('id_ed25519', false),
        ] as any;
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toHaveLength(3);
  });

  it('skips node_modules and .git', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const d = String(dir);
      if (d === '/ws') {
        return [
          dirent('node_modules', true),
          dirent('.git', true),
          dirent('src', true),
          dirent('.env', false),
        ] as any;
      }
      if (d === '/ws/src') {
        return [dirent('.env.local', false)] as any;
      }
      // node_modules and .git should not be entered
      throw new Error(`Should not walk ${d}`);
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toHaveLength(2);
    expect(result.map(r => r.path)).toEqual(['/ws/src/.env.local', '/ws/.env']);
  });

  it('respects maxDepth', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const d = String(dir);
      if (d === '/ws') return [dirent('a', true)] as any;
      if (d === '/ws/a') return [dirent('b', true)] as any;
      if (d === '/ws/a/b') return [dirent('.env', false)] as any;
      return [] as any;
    });

    // maxDepth=1 should not reach /ws/a/b
    const shallow = scanForSensitiveFiles('/ws', 1);
    expect(shallow).toHaveLength(0);

    // maxDepth=3 should reach /ws/a/b
    const deep = scanForSensitiveFiles('/ws', 3);
    expect(deep).toHaveLength(1);
  });

  it('handles unreadable directories gracefully', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const d = String(dir);
      if (d === '/ws') {
        return [dirent('locked', true), dirent('.env', false)] as any;
      }
      if (d === '/ws/locked') {
        throw new Error('EACCES: permission denied');
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    // Should still find .env even though locked/ is unreadable
    expect(result).toEqual([
      { path: '/ws/.env', reason: 'sensitive filename: .env' },
    ]);
  });

  it('returns empty for clean workspace', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      if (String(dir) === '/ws') {
        return [
          dirent('src', true),
          dirent('package.json', false),
          dirent('tsconfig.json', false),
        ] as any;
      }
      if (String(dir) === '/ws/src') {
        return [dirent('index.ts', false)] as any;
      }
      return [] as any;
    });

    const result = scanForSensitiveFiles('/ws');
    expect(result).toHaveLength(0);
  });
});

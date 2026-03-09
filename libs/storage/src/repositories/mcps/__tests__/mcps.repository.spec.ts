import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { McpServersMigration } from '../../../migrations/002-mcp-servers';
import { McpServerRepository } from '../mcps.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  new McpServersMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

let counter = 0;

function makeServer(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    name: `Server ${counter}`,
    slug: `server-${counter}`,
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', `@example/server-${counter}`],
    ...overrides,
  };
}

describe('McpServerRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: McpServerRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new McpServerRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  describe('create', () => {
    it('creates an MCP server with defaults', () => {
      const server = repo.create(makeServer());
      expect(server.id).toBeDefined();
      expect(server.name).toMatch(/^Server \d+$/);
      expect(server.transport).toBe('stdio');
      expect(server.status).toBe('active');
      expect(server.managed).toBe(false);
      expect(server.source).toBe('manual');
      expect(server.args).toEqual(expect.arrayContaining(['-y']));
    });

    it('creates an SSE server with URL', () => {
      const server = repo.create(makeServer({
        transport: 'sse',
        url: 'https://example.com/mcp',
        command: null,
        args: [],
      }));
      expect(server.transport).toBe('sse');
      expect(server.url).toBe('https://example.com/mcp');
    });

    it('enforces slug+profile_id uniqueness', () => {
      repo.create(makeServer({ slug: 'unique-slug' }));
      expect(() => repo.create(makeServer({ slug: 'unique-slug' }))).toThrow();
    });
  });

  describe('createManaged', () => {
    it('creates a managed MCP server with source', () => {
      const server = repo.createManaged(makeServer(), 'cloud');
      expect(server.managed).toBe(true);
      expect(server.managedSource).toBe('cloud');
    });
  });

  describe('getById', () => {
    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });

    it('returns the server by ID', () => {
      const created = repo.create(makeServer());
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });
  });

  describe('getBySlug', () => {
    it('finds by slug with null profileId', () => {
      repo.create(makeServer({ slug: 'test-slug' }));
      const found = repo.getBySlug('test-slug');
      expect(found).not.toBeNull();
      expect(found!.slug).toBe('test-slug');
    });
  });

  describe('getAll', () => {
    it('returns all servers', () => {
      repo.create(makeServer());
      repo.create(makeServer());
      repo.create(makeServer());
      expect(repo.getAll()).toHaveLength(3);
    });
  });

  describe('getEnabled', () => {
    it('returns only active servers', () => {
      repo.create(makeServer());
      repo.create(makeServer({ status: 'disabled' }));
      expect(repo.getEnabled()).toHaveLength(1);
    });
  });

  describe('getManaged', () => {
    it('returns only managed servers', () => {
      repo.create(makeServer());
      repo.createManaged(makeServer(), 'cloud');
      expect(repo.getManaged()).toHaveLength(1);
    });
  });

  describe('getBySource', () => {
    it('filters by source', () => {
      repo.create(makeServer({ source: 'manual' }));
      repo.create(makeServer({ source: 'agenco' }));
      expect(repo.getBySource('agenco')).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('updates fields', () => {
      const created = repo.create(makeServer());
      const updated = repo.update(created.id, { name: 'Updated Name' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
    });

    it('returns null for non-existent ID', () => {
      expect(repo.update('non-existent', { name: 'x' })).toBeNull();
    });

    it('updates status', () => {
      const created = repo.create(makeServer());
      const updated = repo.update(created.id, { status: 'disabled' });
      expect(updated!.status).toBe('disabled');
    });
  });

  describe('delete', () => {
    it('deletes a server', () => {
      const created = repo.create(makeServer());
      expect(repo.delete(created.id)).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    it('returns false for non-existent', () => {
      expect(repo.delete('non-existent')).toBe(false);
    });
  });

  describe('deleteManagedBySource', () => {
    it('deletes managed servers by source', () => {
      repo.createManaged(makeServer(), 'cloud');
      repo.createManaged(makeServer(), 'cloud');
      repo.createManaged(makeServer(), 'other');
      repo.create(makeServer());

      const removed = repo.deleteManagedBySource('cloud');
      expect(removed).toBe(2);
      expect(repo.getAll()).toHaveLength(2);
    });
  });

  describe('count', () => {
    it('counts all servers', () => {
      repo.create(makeServer());
      repo.create(makeServer());
      expect(repo.count()).toBe(2);
    });
  });

  describe('countByStatus', () => {
    it('counts by status', () => {
      repo.create(makeServer());
      repo.create(makeServer({ status: 'blocked' }));
      repo.create(makeServer({ status: 'blocked' }));
      expect(repo.countByStatus('blocked')).toBe(2);
      expect(repo.countByStatus('active')).toBe(1);
    });
  });

  describe('JSON serialization', () => {
    it('round-trips env and headers', () => {
      const server = repo.create(makeServer({
        env: { API_KEY: 'secret', NODE_ENV: 'production' },
        headers: { Authorization: 'Bearer token' },
      }));
      expect(server.env).toEqual({ API_KEY: 'secret', NODE_ENV: 'production' });
      expect(server.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('round-trips supportedTargets', () => {
      const server = repo.create(makeServer({
        supportedTargets: ['claude-code', 'openclaw'],
      }));
      expect(server.supportedTargets).toEqual(['claude-code', 'openclaw']);
    });
  });

  describe('performance', () => {
    it('creates 1000 servers in under 2 seconds', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        repo.create(makeServer());
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
      expect(repo.count()).toBe(1000);
    });
  });
});

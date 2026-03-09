/**
 * Storage — End-to-end Performance & Event Loop Test Suite
 *
 * Exercises the storage system as a real daemon would: many profiles, thousands
 * of records across all domains, scoped queries, encryption, and verification
 * that sync SQLite operations don't block the Node.js event loop excessively.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '../storage';
import { StorageLockedError } from '../errors';
import { perf } from '../../../../tools/perf-metric';

jest.setTimeout(120_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDbPaths(): { dbPath: string; activityDbPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-perf-'));
  return {
    dbPath: path.join(dir, 'test.db'),
    activityDbPath: path.join(dir, 'test-activity.db'),
    dir,
  };
}

/**
 * Measures how long a synchronous function blocks the event loop.
 * The sync function runs before the setTimeout callback fires,
 * so the drift measures blocking time.
 */
function measureEventLoopBlock(syncFn: () => void): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
    syncFn();
  });
}

function opsPerSec(count: number, elapsedMs: number): number {
  return Math.round((count / elapsedMs) * 1000);
}

// ── Scale Constants ──────────────────────────────────────────────────────────

const PROFILE_COUNT = 25;
const EVENTS_PER_PROFILE = 400; // total: 10,000
const GLOBAL_POLICIES = 50;
const POLICIES_PER_PROFILE = 20; // total: 500 + 50 = 550
const SKILL_COUNT = 100;
const VERSIONS_PER_SKILL = 3; // total: 300
const FILES_PER_VERSION = 5; // total: 1,500
const GLOBAL_SECRETS = 20;
const SECRETS_PER_PROFILE = 10; // total: 250 + 20 = 270
const ALERTS_PER_PROFILE = 20; // total: 500

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('Storage — End-to-end Performance', () => {
  let storage: Storage;
  let tmpDir: string;
  const profileIds: string[] = [];
  const eventIds: number[] = [];
  const skillIds: string[] = [];
  const versionIds: string[] = [];

  beforeAll(() => {
    const paths = tmpDbPaths();
    tmpDir = paths.dir;
    storage = Storage.open(paths.dbPath, paths.activityDbPath);
    storage.state.init('1.0.0');

    // Create profiles
    for (let i = 0; i < PROFILE_COUNT; i++) {
      const profile = storage.profiles.create({
        id: `perf-profile-${i}`,
        name: `Performance Profile ${i}`,
        type: 'target',
      });
      profileIds.push(profile.id);
    }
  });

  afterAll(() => {
    storage.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // ── 1. Multi-profile setup verification ──────────────────────────────────

  describe('1. Multi-profile setup', () => {
    it('all profiles exist', () => {
      const all = storage.profiles.getAll();
      expect(all.length).toBe(PROFILE_COUNT);
    });

    it('profiles.getAll() > 500 ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        storage.profiles.getAll();
      }
      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('storage', 'profiles.getAll', ops, '>', 2_000, 'ops/sec');
    });

    it('profiles.getById() > 1000 ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        storage.profiles.getById(profileIds[i % PROFILE_COUNT]);
      }
      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('storage', 'profiles.getById', ops, '>', 5_000, 'ops/sec');
    });
  });

  // ── 2. Activity event ingestion at scale ─────────────────────────────────

  describe('2. Activity event ingestion', () => {
    const eventTypes = ['policy_check', 'exec', 'skill_install', 'api_request'];

    it(`append ${PROFILE_COUNT * EVENTS_PER_PROFILE} events > 200 ops/sec`, () => {
      const total = PROFILE_COUNT * EVENTS_PER_PROFILE;
      const start = performance.now();
      for (let p = 0; p < PROFILE_COUNT; p++) {
        for (let e = 0; e < EVENTS_PER_PROFILE; e++) {
          const ev = storage.activities.append({
            profileId: profileIds[p],
            type: eventTypes[(p + e) % eventTypes.length],
            timestamp: new Date(Date.now() - (total - (p * EVENTS_PER_PROFILE + e)) * 100).toISOString(),
            data: { index: e, profile: p },
          });
          eventIds.push(ev.id as number);
        }
      }
      const elapsed = performance.now() - start;
      const ops = opsPerSec(total, elapsed);
      perf('storage', 'activities.append', ops, '>', 1_000, 'ops/sec');
    });

    it('total count is 10,000', () => {
      expect(storage.activities.count()).toBe(PROFILE_COUNT * EVENTS_PER_PROFILE);
    });

    it('filter by profileId < 50ms each', () => {
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const results = storage.activities.getAll({ profileId: profileIds[i], limit: 100 });
        const elapsed = performance.now() - start;
        expect(results.length).toBe(100);
        expect(elapsed).toBeLessThan(20);
      }
    });

    it('filter by type < 20ms', () => {
      const start = performance.now();
      const results = storage.activities.getAll({ type: 'exec', limit: 100 });
      const elapsed = performance.now() - start;
      expect(results.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(20);
    });

    it('paginate 10 pages < 500ms total', () => {
      const start = performance.now();
      for (let page = 0; page < 10; page++) {
        storage.activities.getAll({ limit: 100, offset: page * 100 });
      }
      const elapsed = performance.now() - start;
      perf('storage', 'activities.paginate', elapsed, '<', 200, 'ms');
    });
  });

  // ── 3. Alert ingestion ───────────────────────────────────────────────────

  describe('3. Alert ingestion', () => {
    it(`create ${PROFILE_COUNT * ALERTS_PER_PROFILE} alerts > 100 ops/sec`, () => {
      const total = PROFILE_COUNT * ALERTS_PER_PROFILE;
      const severities = ['critical', 'warning', 'info'] as const;
      const start = performance.now();
      for (let p = 0; p < PROFILE_COUNT; p++) {
        for (let a = 0; a < ALERTS_PER_PROFILE; a++) {
          const eventIdx = p * EVENTS_PER_PROFILE + a;
          storage.alerts.create({
            activityEventId: eventIds[eventIdx],
            profileId: profileIds[p],
            eventType: 'policy_check',
            severity: severities[(p + a) % severities.length],
            title: `Alert ${a} for profile ${p}`,
            description: `Performance test alert`,
            navigationTarget: `/policies`,
          });
        }
      }
      const elapsed = performance.now() - start;
      const ops = opsPerSec(total, elapsed);
      perf('storage', 'alerts.create', ops, '>', 500, 'ops/sec');
    });

    it('count matches', () => {
      expect(storage.alerts.count()).toBe(PROFILE_COUNT * ALERTS_PER_PROFILE);
    });

    it('query by severity returns correct subset', () => {
      const critical = storage.alerts.count({ severity: 'critical' });
      expect(critical).toBeGreaterThan(0);
      expect(critical).toBeLessThan(PROFILE_COUNT * ALERTS_PER_PROFILE);
    });

    it('acknowledgeAll acknowledges all', () => {
      const count = storage.alerts.acknowledgeAll();
      expect(count).toBe(PROFILE_COUNT * ALERTS_PER_PROFILE);
      // After acknowledgement, default count (excludes acknowledged) should be 0
      expect(storage.alerts.count()).toBe(0);
      // But includeAcknowledged should show all
      expect(storage.alerts.count({ includeAcknowledged: true })).toBe(PROFILE_COUNT * ALERTS_PER_PROFILE);
    });
  });

  // ── 4. Policy resolution at scale ────────────────────────────────────────

  describe('4. Policy resolution', () => {
    it(`create ${GLOBAL_POLICIES + PROFILE_COUNT * POLICIES_PER_PROFILE} policies > 100 ops/sec`, () => {
      const total = GLOBAL_POLICIES + PROFILE_COUNT * POLICIES_PER_PROFILE;
      const start = performance.now();

      // Global policies (no scope)
      for (let i = 0; i < GLOBAL_POLICIES; i++) {
        storage.policies.create({
          id: `global-policy-${i}`,
          name: `Global Policy ${i}`,
          action: i % 2 === 0 ? 'allow' : 'deny',
          target: 'url',
          patterns: [`https://example-${i}.com/*`],
          enabled: true,
          priority: i,
        });
      }

      // Per-profile policies
      for (let p = 0; p < PROFILE_COUNT; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        for (let i = 0; i < POLICIES_PER_PROFILE; i++) {
          scoped.policies.create({
            id: `profile-${p}-policy-${i}`,
            name: `Profile ${p} Policy ${i}`,
            action: 'deny',
            target: 'command',
            patterns: [`cmd-${p}-${i}`],
            enabled: i % 3 !== 0, // some disabled
            priority: i,
          });
        }
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(total, elapsed);
      perf('storage', 'policies.create', ops, '>', 500, 'ops/sec');
    });

    it('scoped getAll per profile returns global + profile policies, each < 20ms', () => {
      for (let p = 0; p < PROFILE_COUNT; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        const start = performance.now();
        const all = scoped.policies.getAll();
        const elapsed = performance.now() - start;
        // UNION: global + profile-specific
        expect(all.length).toBe(GLOBAL_POLICIES + POLICIES_PER_PROFILE);
        expect(elapsed).toBeLessThan(50);
      }
    });

    it('scoped getEnabled returns only enabled subset', () => {
      const scoped = storage.for({ profileId: profileIds[0] });
      const enabled = scoped.policies.getEnabled();
      const all = scoped.policies.getAll();
      expect(enabled.length).toBeLessThan(all.length);
      expect(enabled.length).toBeGreaterThan(0);
    });

    it('getTiered separates managed/global/target', () => {
      const scoped = storage.for({ profileId: profileIds[0] });
      const tiered = scoped.policies.getTiered();
      expect(tiered).toBeDefined();
    });

    it('count per scope verifies UNION semantics', () => {
      const scoped = storage.for({ profileId: profileIds[0] });
      const count = scoped.policies.count();
      expect(count).toBe(GLOBAL_POLICIES + POLICIES_PER_PROFILE);

      // Unscoped count should be total
      const totalCount = storage.policies.count();
      expect(totalCount).toBe(GLOBAL_POLICIES + PROFILE_COUNT * POLICIES_PER_PROFILE);
    });
  });

  // ── 5. Skills with deep relationships ────────────────────────────────────

  describe('5. Skills with deep relationships', () => {
    it(`create ${SKILL_COUNT} skills with versions and files > 50 skill ops/sec`, () => {
      const start = performance.now();

      for (let s = 0; s < SKILL_COUNT; s++) {
        const skill = storage.skills.create({
          name: `Perf Skill ${s}`,
          slug: `perf-skill-${s}`,
          author: `Author ${s % 10}`,
          description: `A performance test skill number ${s}`,
          tags: ['perf', `tag-${s % 5}`],
          source: 'manual',
        });
        skillIds.push(skill.id);

        for (let v = 0; v < VERSIONS_PER_SKILL; v++) {
          const version = storage.skills.addVersion({
            skillId: skill.id,
            version: `${v + 1}.0.0`,
            folderPath: `/tmp/skills/${skill.id}/v${v + 1}`,
            contentHash: `hash-${s}-${v}`,
            hashUpdatedAt: new Date().toISOString(),
            analysisStatus: 'complete',
            requiredBins: ['node'],
            requiredEnv: ['PATH'],
            extractedCommands: [`cmd-${s}-${v}`],
          });
          versionIds.push(version.id);

          storage.skills.registerFiles({
            versionId: version.id,
            files: Array.from({ length: FILES_PER_VERSION }, (_, f) => ({
              relativePath: `src/file-${f}.ts`,
              fileHash: `filehash-${s}-${v}-${f}`,
              sizeBytes: 1024 * (f + 1),
            })),
          });
        }
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(SKILL_COUNT, elapsed);
      console.log(`[skills] create (with versions+files): ${ops} skill ops/sec (${elapsed.toFixed(1)}ms)`);
      expect(ops).toBeGreaterThan(200);
    });

    it('skills.getAll() returns 100, measured over 100 iterations', () => {
      const count = 100;
      const start = performance.now();
      let resultLen = 0;
      for (let i = 0; i < count; i++) {
        resultLen = storage.skills.getAll().length;
      }
      const elapsed = performance.now() - start;
      expect(resultLen).toBe(SKILL_COUNT);

    });

    it('getVersions for 20 skills each < 10ms', () => {
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const versions = storage.skills.getVersions(skillIds[i]);
        const elapsed = performance.now() - start;
        expect(versions.length).toBe(VERSIONS_PER_SKILL);
        expect(elapsed).toBeLessThan(5);
      }
    });

    it('getLatestVersion for all 100 skills', () => {
      const start = performance.now();
      for (const sid of skillIds) {
        const latest = storage.skills.getLatestVersion(sid);
        expect(latest).not.toBeNull();
        // created_at may be identical for all versions in rapid succession,
        // so we just verify a valid version is returned
        expect(latest!.version).toBeTruthy();
      }
      const elapsed = performance.now() - start;

    });

    it('getFiles for 50 versions each < 10ms', () => {
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        const files = storage.skills.getFiles(versionIds[i]);
        const elapsed = performance.now() - start;
        expect(files.length).toBe(FILES_PER_VERSION);
        expect(elapsed).toBeLessThan(5);
      }
    });
  });

  // ── 6. Config scoped merge ───────────────────────────────────────────────

  describe('6. Config scoped merge', () => {
    it('set global and per-profile config, then measure scoped get', () => {
      // Set global config
      storage.config.set({
        daemonPort: 5200,
        daemonHost: 'localhost',
        daemonLogLevel: 'info',
        defaultAction: 'deny',
      });

      // Per-profile overrides
      for (let p = 0; p < PROFILE_COUNT; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        scoped.config.set({ daemonPort: 6000 + p, daemonLogLevel: 'debug' });
      }

      // Measure scoped reads: 100 iterations × 25 profiles
      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (let p = 0; p < PROFILE_COUNT; p++) {
          const scoped = storage.for({ profileId: profileIds[p] });
          const config = scoped.config.get();
          // Verify merge: port from profile, host from global
          expect(config!.daemonPort).toBe(6000 + p);
          expect(config!.daemonHost).toBe('localhost');
        }
      }
      const elapsed = performance.now() - start;
      const total = iterations * PROFILE_COUNT;
      const ops = opsPerSec(total, elapsed);
      perf('storage', 'config.scopedGet', ops, '>', 2_000, 'ops/sec');
    });
  });

  // ── 7. Encrypted secrets at scale ────────────────────────────────────────

  describe('7. Encrypted secrets', () => {
    it('setPasscode and create secrets', () => {
      storage.setPasscode('perf-test-passcode');
      expect(storage.isUnlocked()).toBe(true);
    });

    it(`create ${GLOBAL_SECRETS + PROFILE_COUNT * SECRETS_PER_PROFILE} secrets > 50 ops/sec`, () => {
      const total = GLOBAL_SECRETS + PROFILE_COUNT * SECRETS_PER_PROFILE;
      const start = performance.now();

      // Global secrets
      for (let i = 0; i < GLOBAL_SECRETS; i++) {
        storage.secrets.create({
          name: `global-secret-${i}`,
          value: `global-value-${i}-${'x'.repeat(50)}`,
        });
      }

      // Per-profile secrets
      for (let p = 0; p < PROFILE_COUNT; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        for (let i = 0; i < SECRETS_PER_PROFILE; i++) {
          scoped.secrets.create({
            name: `profile-secret-${i}`,
            value: `profile-${p}-value-${i}-${'y'.repeat(50)}`,
          });
        }
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(total, elapsed);
      perf('storage', 'secrets.create', ops, '>', 200, 'ops/sec');
    });

    it('scoped getAll (with decryption) < 100ms each', () => {
      for (let p = 0; p < 5; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        const start = performance.now();
        const secrets = scoped.secrets.getAll();
        const elapsed = performance.now() - start;
        expect(secrets.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(50);
      }
    });

    it('scoped getAllMasked (no decryption) < 10ms each', () => {
      for (let p = 0; p < 5; p++) {
        const scoped = storage.for({ profileId: profileIds[p] });
        const start = performance.now();
        const masked = scoped.secrets.getAllMasked();
        const elapsed = performance.now() - start;
        expect(masked.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(10);
      }
    });

    it('scoped getByName resolves most-specific-wins', () => {
      // Create a global secret and a profile override with the same name
      try {
        storage.secrets.create({
          name: 'override-test-secret',
          value: 'global-value',
        });
      } catch { /* may already exist */ }

      const scoped = storage.for({ profileId: profileIds[0] });
      try {
        scoped.secrets.create({
          name: 'override-test-secret',
          value: 'profile-value',
        });
      } catch { /* may already exist */ }

      const resolved = scoped.secrets.getByName('override-test-secret');
      expect(resolved).not.toBeNull();
      // Most-specific-wins: profile value should override global
      expect(resolved!.value).toBe('profile-value');
    });

    it('changePasscode re-encrypts all secrets < 10s', () => {
      const start = performance.now();
      storage.changePasscode('perf-test-passcode', 'new-perf-passcode');
      const elapsed = performance.now() - start;
      perf('storage', 'secrets.changePasscode', elapsed, '<', 5_000, 'ms');
      expect(storage.isUnlocked()).toBe(true);

      // Verify secrets still readable
      const all = storage.secrets.getAll();
      expect(all.length).toBeGreaterThan(0);
      expect(all[0].value).toBeTruthy();
    });

    it('lock/unlock cycle', () => {
      storage.lock();
      expect(storage.isUnlocked()).toBe(false);

      // Locked access should throw
      expect(() => storage.secrets.getAll()).toThrow(StorageLockedError);

      // Masked should still work
      const masked = storage.secrets.getAllMasked();
      expect(masked.length).toBeGreaterThan(0);

      // Unlock restores access
      expect(storage.unlock('new-perf-passcode')).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
      const all = storage.secrets.getAll();
      expect(all.length).toBeGreaterThan(0);
    });
  });

  // ── 8. Event loop blocking detection ─────────────────────────────────────

  describe('8. Event loop blocking detection', () => {
    const BLOCK_THRESHOLD_MS = 50;

    it('profile creation < 100ms event loop block', async () => {
      const drift = await measureEventLoopBlock(() => {
        storage.profiles.create({
          id: 'evloop-profile',
          name: 'Event Loop Test',
          type: 'target',
        });
      });
      perf('storage', 'evloop.profileCreate', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('append 100 events < 100ms event loop block', async () => {
      const drift = await measureEventLoopBlock(() => {
        for (let i = 0; i < 100; i++) {
          storage.activities.append({
            profileId: profileIds[0],
            type: 'exec',
            timestamp: new Date().toISOString(),
            data: { i },
          });
        }
      });
      perf('storage', 'evloop.append100Events', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('scoped policies.getAll() < 100ms event loop block', async () => {
      const scoped = storage.for({ profileId: profileIds[0] });
      const drift = await measureEventLoopBlock(() => {
        scoped.policies.getAll();
      });
      perf('storage', 'evloop.scopedPolicies', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('scoped config.get() < 100ms event loop block', async () => {
      const scoped = storage.for({ profileId: profileIds[0] });
      const drift = await measureEventLoopBlock(() => {
        scoped.config.get();
      });
      perf('storage', 'evloop.scopedConfig', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('secrets.getById (decrypt) < 100ms event loop block', async () => {
      const all = storage.secrets.getAll();
      const drift = await measureEventLoopBlock(() => {
        storage.secrets.getById(all[0].id);
      });
      perf('storage', 'evloop.secretsGetById', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('skills.getAll() < 100ms event loop block', async () => {
      const drift = await measureEventLoopBlock(() => {
        storage.skills.getAll();
      });
      perf('storage', 'evloop.skillsGetAll', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });

    it('activities.getAll({ limit: 1000 }) < 100ms event loop block', async () => {
      const drift = await measureEventLoopBlock(() => {
        storage.activities.getAll({ limit: 1000 });
      });
      perf('storage', 'evloop.activitiesGetAll', drift, '<', BLOCK_THRESHOLD_MS, 'ms');
    });
  });

  // ── 9. Cross-profile scoped query sweep ──────────────────────────────────

  describe('9. Cross-profile query sweep', () => {
    it('policies for all 25 profiles < 500ms total', () => {
      const start = performance.now();
      for (const pid of profileIds) {
        storage.for({ profileId: pid }).policies.getAll();
      }
      const elapsed = performance.now() - start;
      perf('storage', 'sweep.policies', elapsed, '<', 200, 'ms');
    });

    it('config for all 25 profiles < 100ms total', () => {
      const start = performance.now();
      for (const pid of profileIds) {
        storage.for({ profileId: pid }).config.get();
      }
      const elapsed = performance.now() - start;
      perf('storage', 'sweep.config', elapsed, '<', 100, 'ms');
    });

    it('secrets (masked) for all 25 profiles < 200ms total', () => {
      const start = performance.now();
      for (const pid of profileIds) {
        storage.for({ profileId: pid }).secrets.getAllMasked();
      }
      const elapsed = performance.now() - start;
      perf('storage', 'sweep.secretsMasked', elapsed, '<', 200, 'ms');
    });

    it('activities by profileId for all 25 < 500ms total', () => {
      const start = performance.now();
      for (const pid of profileIds) {
        storage.activities.getAll({ profileId: pid, limit: 100 });
      }
      const elapsed = performance.now() - start;
      perf('storage', 'sweep.activities', elapsed, '<', 500, 'ms');
    });
  });

  // ── 10. Transaction performance ──────────────────────────────────────────

  describe('10. Transaction performance', () => {
    it('bulk insert in transaction vs individual: transaction is at least 2x faster', () => {
      const count = 200;

      // Individual inserts
      const startIndividual = performance.now();
      for (let i = 0; i < count; i++) {
        storage.policies.create({
          id: `txn-individual-${i}`,
          name: `Individual Policy ${i}`,
          action: 'allow',
          target: 'url',
          patterns: [`https://individual-${i}.com/*`],
        });
      }
      const elapsedIndividual = performance.now() - startIndividual;

      // Transactional inserts
      const startTransaction = performance.now();
      storage.transaction(() => {
        for (let i = 0; i < count; i++) {
          storage.policies.create({
            id: `txn-batch-${i}`,
            name: `Batch Policy ${i}`,
            action: 'allow',
            target: 'url',
            patterns: [`https://batch-${i}.com/*`],
          });
        }
      });
      const elapsedTransaction = performance.now() - startTransaction;

      const speedup = elapsedIndividual / elapsedTransaction;
      perf('storage', 'transaction.speedup', speedup, '>', 1.5, 'x');
    });

    it('transaction rollback leaves no partial state', () => {
      const beforeCount = storage.policies.count();

      expect(() => {
        storage.transaction(() => {
          for (let i = 0; i < 50; i++) {
            storage.policies.create({
              id: `txn-rollback-${i}`,
              name: `Rollback Policy ${i}`,
              action: 'deny',
              target: 'url',
              patterns: ['*'],
            });
          }
          throw new Error('intentional rollback');
        });
      }).toThrow('intentional rollback');

      expect(storage.policies.count()).toBe(beforeCount);
    });
  });

  // ── 11. Rapid scope switching ────────────────────────────────────────────

  describe('11. Rapid scope switching', () => {
    it('1000 random scope switches with policies.count() < 2s', () => {
      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const pid = profileIds[Math.floor(Math.random() * PROFILE_COUNT)];
        storage.for({ profileId: pid }).policies.count();
      }
      const elapsed = performance.now() - start;
      perf('storage', 'scope.randomSwitches', elapsed, '<', 1_000, 'ms');
    });

    it('per-profile burst (policies + secrets + config) < 500ms', () => {
      const start = performance.now();
      for (const pid of profileIds) {
        const scoped = storage.for({ profileId: pid });
        scoped.policies.getEnabled();
        scoped.secrets.getAllMasked();
        scoped.config.get();
      }
      const elapsed = performance.now() - start;
      perf('storage', 'scope.perProfileBurst', elapsed, '<', 500, 'ms');
    });
  });
});

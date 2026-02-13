/**
 * E2E Test: Watcher Integrity Events
 *
 * Tests the full integrity violation → notification → restore chain:
 *   1. Find an installed skill (or upload + approve one)
 *   2. Connect to SSE to collect events
 *   3. Tamper with a skill file on disk
 *   4. Wait for skills:integrity_violation + skills:integrity_restored SSE events
 *   5. Verify the activity feed contains both events
 *   6. Verify the file was restored to its original content
 *
 * Requires a running daemon on port 5200 with at least one skill installed,
 * or the ability to upload one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { daemonAPI, sleep } from '../setup/helpers';

const DAEMON_URL = 'http://localhost:5200';
const SSE_URL = `${DAEMON_URL}/sse/events/skills`;
const POLL_TIMEOUT = 40_000; // Watcher polls every 30s; give extra margin

interface SkillSummary {
  name: string;
  path: string;
  status: string;
  installationId?: string;
}

interface SSEEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Parse raw SSE text into structured events */
function parseSSEChunk(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine.slice(6));
      if (parsed.type) events.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

/** Connect to SSE and collect events until predicate is met or timeout */
async function collectSSEUntil(
  predicate: (events: SSEEvent[]) => boolean,
  timeoutMs: number,
): Promise<SSEEvent[]> {
  const collected: SSEEvent[] = [];
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;

  const response = await fetch(SSE_URL, {
    signal: controller.signal,
    headers: { Accept: 'text/event-stream' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const events = parseSSEChunk(text);
      collected.push(...events);

      if (predicate(collected)) break;
    }
  } catch (err: unknown) {
    if ((err as Error).name !== 'AbortError') throw err;
  } finally {
    controller.abort();
  }

  return collected;
}

/** Upload a minimal test skill, approve it, and return its summary */
async function ensureTestSkill(): Promise<SkillSummary> {
  const slug = 'e2e-watcher-test';

  // Check if already installed
  const listRes = await daemonAPI('GET', '/skills');
  const skills = (listRes.data as { data: SkillSummary[] }).data;
  const existing = skills.find((s) => s.name === slug && s.status === 'active');
  if (existing?.path) return existing;

  // Upload a minimal skill
  const skillMd = [
    '---',
    `name: ${slug}`,
    'version: 1.0.0',
    'author: e2e-test',
    'description: Temporary skill for watcher E2E test',
    'tags: [test]',
    '---',
    '',
    '# E2E Watcher Test Skill',
    '',
    'This skill exists solely to test the integrity watcher.',
  ].join('\n');

  await daemonAPI('POST', '/skills/upload', {
    name: slug,
    files: [{ name: 'SKILL.md', type: 'text/markdown', content: skillMd }],
    meta: { version: '1.0.0', author: 'e2e-test', description: 'Watcher E2E test skill' },
  });

  // Approve the skill (which also installs it)
  await daemonAPI('POST', `/skills/${slug}/approve`);

  // Wait for the install to complete
  await sleep(2000);

  // Fetch updated skill list
  const refreshRes = await daemonAPI('GET', '/skills');
  const refreshed = (refreshRes.data as { data: SkillSummary[] }).data;
  const installed = refreshed.find((s) => s.name === slug && s.status === 'active');

  if (!installed?.path) {
    throw new Error(`Failed to set up test skill "${slug}" — not found in skill list after approve`);
  }

  return installed;
}

describe('watcher integrity events', () => {
  let skill: SkillSummary;
  let skillMdPath: string;
  let originalContent: string;

  beforeAll(async () => {
    // Ensure daemon is reachable
    const health = await daemonAPI('GET', '/health');
    if (health.status !== 200) {
      throw new Error('Daemon not running on port 5200. Start it first.');
    }

    // Get or create a test skill
    skill = await ensureTestSkill();
    skillMdPath = path.join(skill.path, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`Skill file not found on disk: ${skillMdPath}`);
    }

    originalContent = fs.readFileSync(skillMdPath, 'utf-8');
  }, 30_000);

  afterAll(async () => {
    // Restore original content if test left it tampered
    if (skillMdPath && originalContent) {
      try {
        const current = fs.readFileSync(skillMdPath, 'utf-8');
        if (current !== originalContent) {
          fs.writeFileSync(skillMdPath, originalContent);
        }
      } catch {
        // Best-effort cleanup
      }
    }
  });

  it('tampered file triggers integrity_violation and integrity_restored SSE events', async () => {
    // Start collecting SSE events BEFORE tampering
    const ssePromise = collectSSEUntil(
      (events) =>
        events.some((e) => e.type === 'skills:integrity_restored') ||
        events.some((e) => e.type === 'skills:integrity_violation'),
      POLL_TIMEOUT,
    );

    // Small delay to ensure SSE connection is established
    await sleep(500);

    // Tamper with the skill file
    fs.writeFileSync(skillMdPath, '# TAMPERED BY E2E TEST\nThis should trigger integrity violation.');

    // Wait for SSE events (up to 40s for poll cycle)
    const events = await ssePromise;

    // Assert: integrity violation was detected
    const violation = events.find((e) => e.type === 'skills:integrity_violation');
    expect(violation).toBeDefined();
    expect(violation!.data.action).toBe('reinstall');

    // Wait for the restore to complete (may lag slightly behind the violation)
    if (!events.some((e) => e.type === 'skills:integrity_restored')) {
      const moreEvents = await collectSSEUntil(
        (evts) => evts.some((e) => e.type === 'skills:integrity_restored'),
        10_000,
      );
      events.push(...moreEvents);
    }

    const restored = events.find((e) => e.type === 'skills:integrity_restored');
    expect(restored).toBeDefined();
  }, POLL_TIMEOUT + 15_000);

  it('file was restored to original content after watcher reinstall', () => {
    // The watcher should have reinstalled the original file
    const currentContent = fs.readFileSync(skillMdPath, 'utf-8');
    expect(currentContent).toBe(originalContent);
  });

  it('activity feed contains integrity events', async () => {
    const res = await daemonAPI('GET', '/activity?limit=50');
    expect(res.status).toBe(200);

    const activity = (res.data as { data: Array<{ type: string }> }).data;
    const types = activity.map((e) => e.type);

    expect(types).toContain('skills:integrity_violation');
    expect(types).toContain('skills:integrity_restored');
  });

  it('deleted file triggers integrity violation and gets restored', async () => {
    // Read the current content before deleting
    const preContent = fs.readFileSync(skillMdPath, 'utf-8');

    // Start collecting SSE events
    const ssePromise = collectSSEUntil(
      (events) => events.some((e) => e.type === 'skills:integrity_restored'),
      POLL_TIMEOUT,
    );

    await sleep(500);

    // Delete the SKILL.md file
    fs.unlinkSync(skillMdPath);
    expect(fs.existsSync(skillMdPath)).toBe(false);

    // Wait for restore
    const events = await ssePromise;

    // Assert: violation detected with missing file
    const violation = events.find((e) => e.type === 'skills:integrity_violation');
    expect(violation).toBeDefined();

    // Assert: file restored
    const restored = events.find((e) => e.type === 'skills:integrity_restored');
    expect(restored).toBeDefined();

    // Assert: file is back on disk with original content
    expect(fs.existsSync(skillMdPath)).toBe(true);
    const restoredContent = fs.readFileSync(skillMdPath, 'utf-8');
    expect(restoredContent).toBe(preContent);
  }, POLL_TIMEOUT + 15_000);
});

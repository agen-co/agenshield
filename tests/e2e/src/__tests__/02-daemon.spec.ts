/**
 * E2E Test: Daemon Lifecycle
 *
 * Starts the daemon and verifies all API endpoints respond correctly:
 * - Health endpoint
 * - Status endpoint
 * - AgenCo auth status
 * - AgenCo MCP status
 * - SSE event stream
 */

import {
  runCLI,
  waitForDaemon,
  waitForDaemonStop,
  daemonAPI,
  sleep,
} from '../setup/helpers';

describe('daemon lifecycle', () => {
  it('should start the daemon', () => {
    const result = runCLI('daemon start', { timeout: 30_000 });
    expect(result.exitCode).toBe(0);
  });

  it('should be reachable via health endpoint', async () => {
    const healthy = await waitForDaemon(5200, 15_000);
    expect(healthy).toBe(true);
  });

  it('GET /api/health should return ok', async () => {
    const res = await daemonAPI('GET', '/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/status should return running status', async () => {
    const res = await daemonAPI('GET', '/status');
    expect(res.status).toBe(200);
    const body = res.data as { success: boolean; data: { running: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.running).toBe(true);
  });

  it('GET /api/agenco/auth/status should return not authenticated', async () => {
    const res = await daemonAPI('GET', '/agenco/auth/status');
    expect(res.status).toBe(200);
    const body = res.data as { success: boolean; data: { authenticated: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.authenticated).toBe(false);
  });

  it('GET /api/agenco/mcp/status should return disconnected', async () => {
    const res = await daemonAPI('GET', '/agenco/mcp/status');
    expect(res.status).toBe(200);
    const body = res.data as { success: boolean; data: { state: string } };
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('disconnected');
  });

  it('SSE /sse/events should be connectable', async () => {
    // Verify the SSE endpoint accepts connections
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch('http://localhost:5200/sse/events', {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    } catch (err: unknown) {
      // AbortError is expected — we just need to verify the connection was accepted
      if ((err as Error).name !== 'AbortError') {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  it('daemon should report running via CLI status', () => {
    const result = runCLI('daemon status');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('running');
  });
});

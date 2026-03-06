import { handlePing } from '../../handlers/ping.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

describe('handlePing', () => {
  const ctx = createHandlerContext();
  const deps = createMockDeps();

  it('should return pong with timestamp and version', async () => {
    const result = await handlePing({}, ctx, deps);
    expect(result.success).toBe(true);
    expect(result.data!.pong).toBe(true);
    expect(result.data!.version).toBe('0.1.0');
    expect(result.data!.timestamp).toBeDefined();
  });

  it('should echo back the echo param', async () => {
    const result = await handlePing({ echo: 'hello' }, ctx, deps);
    expect(result.data!.echo).toBe('hello');
  });

  it('should have undefined echo when not provided', async () => {
    const result = await handlePing({}, ctx, deps);
    expect(result.data!.echo).toBeUndefined();
  });
});

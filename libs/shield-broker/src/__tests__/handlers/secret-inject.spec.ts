import { handleSecretInject } from '../../handlers/secret-inject.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

describe('handleSecretInject', () => {
  it('should return error 1003 when name is missing', async () => {
    const result = await handleSecretInject({}, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1008 when channel is not socket', async () => {
    const ctx = createHandlerContext({ channel: 'http' });
    const result = await handleSecretInject({ name: 'API_KEY' }, ctx, createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1008);
  });

  it('should return error 1007 when secret not found', async () => {
    const deps = createMockDeps();
    (deps.secretVault.get as jest.Mock).mockResolvedValue(null);
    const result = await handleSecretInject({ name: 'MISSING' }, createHandlerContext(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1007);
  });

  it('should return value and injected:true on success', async () => {
    const deps = createMockDeps();
    (deps.secretVault.get as jest.Mock).mockResolvedValue({ value: 'secret-val' });
    const result = await handleSecretInject({ name: 'API_KEY' }, createHandlerContext(), deps);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ value: 'secret-val', injected: true });
  });

  it('should return error 1007 on vault error', async () => {
    const deps = createMockDeps();
    (deps.secretVault.get as jest.Mock).mockRejectedValue(new Error('vault locked'));
    const result = await handleSecretInject({ name: 'KEY' }, createHandlerContext(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1007);
    expect(result.error!.message).toContain('vault locked');
  });
});

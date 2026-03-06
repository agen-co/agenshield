import { handleSecretsSync } from '../../handlers/secrets-sync.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

describe('handleSecretsSync', () => {
  it('should return error 1002 when channel is not socket', async () => {
    const ctx = createHandlerContext({ channel: 'http' });
    const result = await handleSecretsSync({}, ctx, createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1002);
  });

  it('should return error -32000 when secretResolver not configured', async () => {
    const deps = createMockDeps();
    deps.secretResolver = undefined;
    const result = await handleSecretsSync({}, createHandlerContext(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(-32000);
  });

  it('should handle clear:true by calling resolver.clear()', async () => {
    const deps = createMockDeps();
    const result = await handleSecretsSync({ clear: true }, createHandlerContext(), deps);
    expect(result.success).toBe(true);
    expect(deps.secretResolver!.clear).toHaveBeenCalled();
  });

  it('should return error -32602 when payload is missing required fields', async () => {
    const result = await handleSecretsSync(
      { version: '1.0.0' }, // missing globalSecrets and policyBindings
      createHandlerContext(),
      createMockDeps()
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(-32602);
  });

  it('should call updateFromPush with correct payload', async () => {
    const deps = createMockDeps();
    const payload = {
      version: '1.0.0',
      globalSecrets: { KEY: 'val' },
      policyBindings: [
        { policyId: 'p1', target: 'command' as const, patterns: ['*'], secrets: { S: 'v' } },
      ],
    };
    const result = await handleSecretsSync(payload, createHandlerContext(), deps);
    expect(result.success).toBe(true);
    expect(deps.secretResolver!.updateFromPush).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '1.0.0',
        globalSecrets: { KEY: 'val' },
        policyBindings: payload.policyBindings,
      })
    );
  });

  it('should return globalCount and bindingCount', async () => {
    const payload = {
      version: '1.0.0',
      globalSecrets: { A: '1', B: '2' },
      policyBindings: [
        { policyId: 'p1', target: 'command' as const, patterns: ['*'], secrets: { S: 'v' } },
      ],
    };
    const result = await handleSecretsSync(payload, createHandlerContext(), createMockDeps());
    expect(result.data).toEqual(expect.objectContaining({
      globalCount: 2,
      bindingCount: 1,
    }));
  });
});

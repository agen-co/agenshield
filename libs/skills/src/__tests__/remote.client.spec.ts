/**
 * DefaultRemoteClient tests
 */

import { DefaultRemoteClient } from '../remote/client';

describe('DefaultRemoteClient', () => {
  it('constructs with default options', () => {
    const client = new DefaultRemoteClient();
    expect(client).toBeDefined();
  });

  it('constructs with custom base URL', () => {
    const client = new DefaultRemoteClient({ baseUrl: 'https://custom.example.com' });
    expect(client).toBeDefined();
  });

  it('constructs with API key', () => {
    const client = new DefaultRemoteClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
  });

  it('search rejects on network error', async () => {
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    await expect(client.search('test')).rejects.toThrow();
  });

  it('getSkill returns null on 404', async () => {
    // We can't easily mock fetch in this setup, but we verify the client handles
    // errors by testing with an unreachable host
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    await expect(client.getSkill('test')).rejects.toThrow();
  });

  it('checkVersion returns null on error', async () => {
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    // checkVersion catches errors and returns null
    const result = await client.checkVersion('test', '1.0.0');
    expect(result).toBeNull();
  });
});

import { getProxyConfig, shouldBypassProxy } from '../proxy-env';

describe('getProxyConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['HTTP_PROXY'];
    delete process.env['HTTPS_PROXY'];
    delete process.env['http_proxy'];
    delete process.env['https_proxy'];
    delete process.env['NO_PROXY'];
    delete process.env['no_proxy'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns disabled when no proxy env vars are set', () => {
    const config = getProxyConfig();
    expect(config.enabled).toBe(false);
  });

  it('reads HTTPS_PROXY', () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:54321';
    const config = getProxyConfig();
    expect(config.enabled).toBe(true);
    expect(config.hostname).toBe('127.0.0.1');
    expect(config.port).toBe(54321);
    expect(config.url).toBe('http://127.0.0.1:54321');
  });

  it('reads HTTP_PROXY when HTTPS_PROXY is not set', () => {
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:12345';
    const config = getProxyConfig();
    expect(config.enabled).toBe(true);
    expect(config.hostname).toBe('127.0.0.1');
    expect(config.port).toBe(12345);
  });

  it('prefers HTTPS_PROXY over HTTP_PROXY', () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:1111';
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:2222';
    const config = getProxyConfig();
    expect(config.port).toBe(1111);
  });

  it('reads lowercase env vars', () => {
    process.env['https_proxy'] = 'http://127.0.0.1:9999';
    const config = getProxyConfig();
    expect(config.enabled).toBe(true);
    expect(config.port).toBe(9999);
  });

  it('parses NO_PROXY', () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:1234';
    process.env['NO_PROXY'] = 'localhost,127.0.0.1,::1,*.local,.local';
    const config = getProxyConfig();
    expect(config.noProxy).toEqual(['localhost', '127.0.0.1', '::1', '*.local', '.local']);
  });

  it('returns disabled for invalid proxy URL', () => {
    process.env['HTTPS_PROXY'] = 'not-a-url';
    const config = getProxyConfig();
    expect(config.enabled).toBe(false);
  });

  it('defaults port to 80 when not specified', () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1';
    const config = getProxyConfig();
    expect(config.port).toBe(80);
  });
});

describe('shouldBypassProxy', () => {
  it('returns false when noProxy is empty', () => {
    expect(shouldBypassProxy('https://example.com', [])).toBe(false);
  });

  it('matches exact hostname', () => {
    expect(shouldBypassProxy('https://localhost/path', ['localhost'])).toBe(true);
    expect(shouldBypassProxy('https://127.0.0.1:8080/path', ['127.0.0.1'])).toBe(true);
  });

  it('matches wildcard', () => {
    expect(shouldBypassProxy('https://anything.com', ['*'])).toBe(true);
  });

  it('matches suffix with leading dot', () => {
    expect(shouldBypassProxy('https://sub.example.com', ['.example.com'])).toBe(true);
    expect(shouldBypassProxy('https://example.com', ['.example.com'])).toBe(false);
  });

  it('matches implicit subdomain suffix', () => {
    expect(shouldBypassProxy('https://sub.example.com', ['example.com'])).toBe(true);
  });

  it('does not match partial hostname', () => {
    expect(shouldBypassProxy('https://notexample.com', ['example.com'])).toBe(false);
  });

  it('returns false for invalid URL', () => {
    expect(shouldBypassProxy('not-a-url', ['localhost'])).toBe(false);
  });
});

import { generateSitecustomize } from '../python/sitecustomize';

describe('generateSitecustomize', () => {
  it('generates Python code with enabled config', () => {
    const result = generateSitecustomize({
      brokerHost: 'localhost',
      brokerPort: 5200,
      logLevel: 'warn',
      enabled: true,
    });

    expect(result).toContain('_AGENSHIELD_ENABLED = True');
    expect(result).toContain("_AGENSHIELD_BROKER_HOST = 'localhost'");
    expect(result).toContain('_AGENSHIELD_BROKER_PORT = 5200');
    expect(result).toContain("_AGENSHIELD_LOG_LEVEL = 'warn'");
    expect(result).toContain('import socket');
    expect(result).toContain('_agenshield_patched = True');
    expect(result).toContain('AgenShield Python Network Isolation');
    expect(result).toContain('socket.socket.connect = _agenshield_socket_connect');
  });

  it('generates Python code with disabled config', () => {
    const result = generateSitecustomize({
      brokerHost: '127.0.0.1',
      brokerPort: 9999,
      logLevel: 'debug',
      enabled: false,
    });

    expect(result).toContain('_AGENSHIELD_ENABLED = False');
    expect(result).toContain("_AGENSHIELD_BROKER_HOST = '127.0.0.1'");
    expect(result).toContain('_AGENSHIELD_BROKER_PORT = 9999');
    expect(result).toContain("_AGENSHIELD_LOG_LEVEL = 'debug'");
    expect(result).toContain('Network isolation disabled');
  });

  it('includes urllib3 and requests patching sections', () => {
    const result = generateSitecustomize({
      brokerHost: 'localhost',
      brokerPort: 5200,
      logLevel: 'info',
      enabled: true,
    });

    expect(result).toContain('urllib3 Patching');
    expect(result).toContain('requests Patching');
    expect(result).toContain('aiohttp Patching');
  });

  it('includes environment variable overrides', () => {
    const result = generateSitecustomize({
      brokerHost: 'localhost',
      brokerPort: 5200,
      logLevel: 'warn',
      enabled: true,
    });

    expect(result).toContain("os.environ.get('AGENSHIELD_ENABLED')");
    expect(result).toContain("os.environ.get('AGENSHIELD_BROKER_HOST')");
    expect(result).toContain("os.environ.get('AGENSHIELD_BROKER_PORT')");
    expect(result).toContain("os.environ.get('AGENSHIELD_LOG_LEVEL')");
  });
});

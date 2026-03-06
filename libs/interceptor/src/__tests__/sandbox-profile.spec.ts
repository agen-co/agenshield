import { generateSandboxProfile } from '../python/sandbox-profile';

describe('generateSandboxProfile', () => {
  it('generates SBPL with base config', () => {
    const result = generateSandboxProfile({
      workspacePath: '/Users/agent/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(version 1)');
    expect(result).toContain('(deny default)');
    expect(result).toContain('AgenShield Python Sandbox Profile');
  });

  it('includes system library paths', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(subpath "/System")');
    expect(result).toContain('(subpath "/usr/lib")');
    expect(result).toContain('(subpath "/usr/share")');
    expect(result).toContain('(subpath "/Library/Frameworks")');
  });

  it('includes Python installation paths', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/local/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(subpath "/usr/local/bin/python3")');
    expect(result).toContain('(subpath "/Library/Frameworks/Python.framework")');
    expect(result).toContain('(subpath "/opt/homebrew/lib/python")');
  });

  it('includes workspace path with read/write access', () => {
    const result = generateSandboxProfile({
      workspacePath: '/Users/agent/project',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(allow file-read* file-write*');
    expect(result).toContain('(subpath "/Users/agent/project")');
  });

  it('restricts network to broker only', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: '127.0.0.1',
      brokerPort: 5201,
    });

    expect(result).toContain('(deny network*)');
    expect(result).toContain('(remote tcp "127.0.0.1:5201")');
    expect(result).toContain('(remote tcp "localhost:5201")');
  });

  it('includes additional read paths', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
      additionalReadPaths: ['/data/models', '/opt/shared'],
    });

    expect(result).toContain('(allow file-read* (subpath "/data/models"))');
    expect(result).toContain('(allow file-read* (subpath "/opt/shared"))');
  });

  it('includes additional write paths', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
      additionalWritePaths: ['/tmp/output'],
    });

    expect(result).toContain('(allow file-write* (subpath "/tmp/output"))');
  });

  it('handles empty additional paths', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
      additionalReadPaths: [],
      additionalWritePaths: [],
    });

    expect(result).toContain('(version 1)');
    // Should still be valid without extra paths
    expect(result).toContain('Additional Paths');
  });

  it('includes process and signal permissions', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(allow process-fork)');
    expect(result).toContain('(allow process-exec');
    expect(result).toContain('(literal "/usr/bin/python3")');
    expect(result).toContain('(allow signal (target self))');
    expect(result).toContain('(allow sysctl-read)');
  });

  it('includes mach IPC and user defaults', () => {
    const result = generateSandboxProfile({
      workspacePath: '/workspace',
      pythonPath: '/usr/bin/python3',
      brokerHost: 'localhost',
      brokerPort: 5200,
    });

    expect(result).toContain('(allow mach-lookup');
    expect(result).toContain('(allow user-preference-read)');
  });
});

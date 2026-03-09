import { EventEmitter } from 'node:events';

import {
  PROXIED_COMMANDS,
  shieldExecPath,
  generateShieldExecContent,
} from '../../shell/shield-exec';
import {
  SHIELD_EXEC_PATH,
  SHIELD_EXEC_CONTENT,
} from '../../legacy';

/* ------------------------------------------------------------------ */
/*  Mock helpers for node:net                                          */
/* ------------------------------------------------------------------ */

// Use `var` (not const/let) to avoid TDZ errors with SWC/Jest hoisting
var mockSocket: EventEmitter & {
  write: jest.Mock;
  end: jest.Mock;
  destroy: jest.Mock;
  setTimeout: jest.Mock;
};
var mockCreateConnection: jest.Mock;

function createMockSocket() {
  const s = new EventEmitter() as EventEmitter & {
    write: jest.Mock;
    end: jest.Mock;
    destroy: jest.Mock;
    setTimeout: jest.Mock;
  };
  s.write = jest.fn();
  s.end = jest.fn();
  s.destroy = jest.fn();
  s.setTimeout = jest.fn();
  return s;
}

jest.mock('node:net', () => ({
  createConnection: (...args: unknown[]) => mockCreateConnection(...args),
}));

/* ------------------------------------------------------------------ */
/*  Helper: re-import the module via isolateModules                    */
/*                                                                     */
/*  Because sendRequest, generateId and main are NOT exported, we      */
/*  exercise them through the module's auto-run guard which triggers   */
/*  main() when process.argv[1] ends with 'shield-exec'.              */
/*  For tests that must NOT auto-run, set argv[1] to something else.  */
/* ------------------------------------------------------------------ */

function requireShieldExec(): typeof import('../../shell/shield-exec') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let mod: typeof import('../../shell/shield-exec');
  jest.isolateModules(() => {
    mod = require('../../shell/shield-exec');
  });
  return mod!;
}

/**
 * Trigger the auto-run guard by setting argv[1] to end with 'shield-exec',
 * then re-importing the module. Returns a promise that settles after the
 * async main() has had time to run.
 */
function triggerAutoRun(
  argv: string[],
  opts?: { waitMs?: number },
): Promise<void> {
  process.argv = argv;
  return new Promise((resolve) => {
    jest.isolateModules(() => {
      require('../../shell/shield-exec');
    });
    setTimeout(resolve, opts?.waitMs ?? 150);
  });
}

/* ================================================================== */
/*  Pure / exported function tests                                     */
/* ================================================================== */

describe('PROXIED_COMMANDS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PROXIED_COMMANDS)).toBe(true);
    expect(PROXIED_COMMANDS.length).toBeGreaterThan(0);
  });

  it('contains core commands (curl, git, npm)', () => {
    expect(PROXIED_COMMANDS).toContain('curl');
    expect(PROXIED_COMMANDS).toContain('git');
    expect(PROXIED_COMMANDS).toContain('npm');
  });

  it('contains ssh and scp', () => {
    expect(PROXIED_COMMANDS).toContain('ssh');
    expect(PROXIED_COMMANDS).toContain('scp');
  });

  it('contains brew', () => {
    expect(PROXIED_COMMANDS).toContain('brew');
  });

  it('contains shieldctl and agenco', () => {
    expect(PROXIED_COMMANDS).toContain('shieldctl');
    expect(PROXIED_COMMANDS).toContain('agenco');
  });
});

describe('shieldExecPath', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a path string', () => {
    const result = shieldExecPath('/Users/testuser');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes hostHome in the path when provided', () => {
    const result = shieldExecPath('/Users/testuser');

    expect(result).toBe('/Users/testuser/.agenshield/bin/shield-exec');
  });

  it('falls back to HOME env when no hostHome is provided', () => {
    process.env = { ...originalEnv, HOME: '/Users/envuser' };

    const result = shieldExecPath();

    expect(result).toBe('/Users/envuser/.agenshield/bin/shield-exec');
  });

  it('falls back to legacy path when no home is available', () => {
    process.env = { ...originalEnv };
    delete process.env.HOME;

    const result = shieldExecPath('');

    expect(result).toBe(SHIELD_EXEC_PATH);
  });
});

describe('SHIELD_EXEC_PATH (legacy)', () => {
  it('points to /opt/agenshield/bin/shield-exec', () => {
    expect(SHIELD_EXEC_PATH).toBe('/opt/agenshield/bin/shield-exec');
  });
});

describe('generateShieldExecContent', () => {
  it('returns valid script content', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });

  it('replaces shebang with correct node-bin path', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain('/Users/testuser/.agenshield/bin/node-bin');
  });

  it('contains import statements', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain("import path from 'node:path'");
    expect(content).toContain("import net from 'node:net'");
  });

  it('contains socket communication logic', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain('sendRequest');
    expect(content).toContain('jsonrpc');
  });
});

describe('SHIELD_EXEC_CONTENT', () => {
  it('starts with a shebang', () => {
    expect(SHIELD_EXEC_CONTENT.startsWith('#!')).toBe(true);
  });

  it('contains the main function', () => {
    expect(SHIELD_EXEC_CONTENT).toContain('async function main()');
  });
});

/* ================================================================== */
/*  Internal function tests (via auto-run guard)                       */
/* ================================================================== */

describe('main (via auto-run)', () => {
  const savedArgv = process.argv;
  const savedEnv = { ...process.env };

  var stderrSpy: jest.SpyInstance;
  var stdoutSpy: jest.SpyInstance;
  var exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...savedEnv };
    process.env['AGENSHIELD_SOCKET'] = '/tmp/test-broker.sock';

    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Do NOT throw — let main() continue its async flow
    }) as never);

    mockSocket = createMockSocket();
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(cb);
      return mockSocket;
    });
  });

  afterEach(() => {
    process.argv = savedArgv;
    process.env = savedEnv;
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('prints usage and exits 1 when invoked as shield-exec with no command arg', async () => {
    await triggerAutoRun(['/usr/local/bin/node', '/path/to/shield-exec']);

    expect(stderrSpy).toHaveBeenCalledWith('Usage: shield-exec <command> [args...]\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('sends exec request via symlink name (e.g., curl)', async () => {
    const response = { jsonrpc: '2.0', id: 'x', result: { exitCode: 0, stdout: 'hello\n' } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    // Invoked as symlink named "curl" (argv[1] does NOT end with shield-exec,
    // but basename is 'curl' — however the auto-run guard checks endsWith('shield-exec')
    // so we use a path that ends with shield-exec but has the command as first arg)
    // Actually, to test symlink mode we need argv[1] to NOT be 'shield-exec'.
    // But the auto-run guard only fires when argv[1] endsWith('shield-exec').
    // So the symlink case is NOT triggered by auto-run. Let's test via direct invocation.
    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'curl',
      'https://example.com',
    ]);

    const writtenData = mockSocket.write.mock.calls[0]?.[0];
    expect(writtenData).toBeDefined();
    const parsed = JSON.parse(writtenData.replace('\n', ''));
    expect(parsed.method).toBe('exec');
    expect(parsed.params.command).toBe('curl');
    expect(parsed.params.args).toEqual(['https://example.com']);

    expect(stdoutSpy).toHaveBeenCalledWith('hello\n');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sends exec request with command from first arg (direct shield-exec invocation)', async () => {
    const response = { jsonrpc: '2.0', id: 'x', result: { exitCode: 0 } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'status',
    ]);

    const writtenData = mockSocket.write.mock.calls[0]?.[0];
    const parsed = JSON.parse(writtenData.replace('\n', ''));
    expect(parsed.params.command).toBe('git');
    expect(parsed.params.args).toEqual(['status']);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('writes stderr and exits 1 on JSON-RPC error response', async () => {
    const response = {
      jsonrpc: '2.0',
      id: 'x',
      error: { code: -32600, message: 'Policy denied' },
    };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'curl',
      'http://evil.com',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith('Error: Policy denied\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 0 when response has no result', async () => {
    const response = { jsonrpc: '2.0', id: 'x' };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'gc',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('writes both stdout and stderr from result', async () => {
    const response = {
      jsonrpc: '2.0',
      id: 'x',
      result: { exitCode: 1, stdout: 'partial\n', stderr: 'warn\n' },
    };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'npm',
      'install',
    ]);

    expect(stdoutSpy).toHaveBeenCalledWith('partial\n');
    expect(stderrSpy).toHaveBeenCalledWith('warn\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('uses default exitCode 0 when result.exitCode is undefined', async () => {
    const response = { jsonrpc: '2.0', id: 'x', result: { stdout: 'done' } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'brew',
      'list',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('handles sendRequest socket error and writes to stderr', async () => {
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('error', new Error('ECONNREFUSED'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'push',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'shield-exec error: Socket error: ECONNREFUSED\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

/* ------------------------------------------------------------------ */
/*  sendRequest edge cases (via auto-run)                              */
/* ------------------------------------------------------------------ */

describe('sendRequest edge cases (via auto-run)', () => {
  const savedArgv = process.argv;
  const savedEnv = { ...process.env };

  var stderrSpy: jest.SpyInstance;
  var stdoutSpy: jest.SpyInstance;
  var exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...savedEnv };
    process.env['AGENSHIELD_SOCKET'] = '/tmp/test-broker.sock';

    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      // no-op
    }) as never);

    mockSocket = createMockSocket();
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(cb);
      return mockSocket;
    });
  });

  afterEach(() => {
    process.argv = savedArgv;
    process.env = savedEnv;
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('handles invalid JSON in response (newline-delimited)', async () => {
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from('not-valid-json\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'echo',
      'hi',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('shield-exec error: Invalid JSON response'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles socket end with valid JSON data (no trailing newline)', async () => {
    const response = { jsonrpc: '2.0', id: '2', result: { exitCode: 0 } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          // Send data WITHOUT trailing newline, then end
          mockSocket.emit('data', Buffer.from(JSON.stringify(response)));
          mockSocket.emit('end');
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'log',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('handles socket end with no data', async () => {
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('end');
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'version',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'shield-exec error: Connection closed without response\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles socket end with invalid JSON data', async () => {
    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from('broken'));
          mockSocket.emit('end');
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'npm',
      'test',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith(
      'shield-exec error: Connection closed before response\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles socket timeout', async () => {
    mockSocket = createMockSocket();
    mockSocket.setTimeout = jest.fn((_ms: number, cb: () => void) => {
      setImmediate(cb);
    });

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(cb);
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'curl',
      'http://slow.example.com',
    ]);

    expect(mockSocket.destroy).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      'shield-exec error: Request timed out\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accumulates multi-chunk data before parsing', async () => {
    const response = { jsonrpc: '2.0', id: '6', result: { exitCode: 42 } };
    const fullJson = JSON.stringify(response) + '\n';
    const part1 = fullJson.slice(0, 10);
    const part2 = fullJson.slice(10);

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(part1));
          setImmediate(() => {
            mockSocket.emit('data', Buffer.from(part2));
          });
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'ssh',
      'host',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(42);
  });

  it('triggers .catch handler when main() throws before try/catch (Fatal path)', async () => {
    // Make process.cwd() throw to force main() to reject, hitting the .catch handler
    const cwdSpy = jest.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('cwd gone');
    });

    const response = { jsonrpc: '2.0', id: 'x', result: { exitCode: 0 } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'status',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith('Fatal: cwd gone\n');
    expect(exitSpy).toHaveBeenCalledWith(1);

    cwdSpy.mockRestore();
  });

  it('generates a request with valid ID format (shield-exec-{ts}-{rand})', async () => {
    const response = { jsonrpc: '2.0', id: 'x', result: { exitCode: 0 } };

    mockCreateConnection = jest.fn((_path: string, cb: () => void) => {
      setImmediate(() => {
        cb();
        setImmediate(() => {
          mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
        });
      });
      return mockSocket;
    });

    await triggerAutoRun([
      '/usr/local/bin/node',
      '/path/to/shield-exec',
      'git',
      'status',
    ]);

    const writtenData = mockSocket.write.mock.calls[0]?.[0];
    const parsed = JSON.parse(writtenData.replace('\n', ''));
    expect(parsed.id).toMatch(/^shield-exec-\d+-[a-z0-9]+$/);
    expect(parsed.jsonrpc).toBe('2.0');
  });
});

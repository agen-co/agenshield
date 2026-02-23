import { execSync } from 'node:child_process';
import { sudoExec, type SudoResult } from '../../exec/sudo';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('sudoExec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success with trimmed output on successful execution', () => {
    mockedExecSync.mockReturnValue('  hello world  ');

    const result: SudoResult = sudoExec('echo hello');

    expect(result).toEqual({ success: true, output: 'hello world' });
    expect(mockedExecSync).toHaveBeenCalledWith('sudo echo hello', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('returns failure with stderr on command failure', () => {
    const error = new Error('command failed') as Error & { stderr: string };
    error.stderr = 'permission denied';
    mockedExecSync.mockImplementation(() => {
      throw error;
    });

    const result: SudoResult = sudoExec('rm /protected');

    expect(result).toEqual({ success: false, error: 'permission denied' });
  });

  it('returns failure with message when stderr is not available', () => {
    const error = new Error('generic failure');
    mockedExecSync.mockImplementation(() => {
      throw error;
    });

    const result: SudoResult = sudoExec('bad-command');

    expect(result).toEqual({ success: false, error: 'generic failure' });
  });

  it('returns "Unknown error" when error has no stderr or message', () => {
    mockedExecSync.mockImplementation(() => {
      throw {};
    });

    const result: SudoResult = sudoExec('weird-cmd');

    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('trims output whitespace including newlines', () => {
    mockedExecSync.mockReturnValue('\n  line1\n  \n');

    const result: SudoResult = sudoExec('cat file');

    expect(result.success).toBe(true);
    expect(result.output).toBe('line1');
  });

  it('prepends "sudo" to the command', () => {
    mockedExecSync.mockReturnValue('');

    sudoExec('dscl . -read /Users/test');

    expect(mockedExecSync).toHaveBeenCalledWith(
      'sudo dscl . -read /Users/test',
      expect.any(Object),
    );
  });
});

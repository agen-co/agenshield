import {
  GUARDED_SHELL_CONTENT,
  guardedShellPath,
  zdotDir,
  zdotZshenvContent,
  ZDOT_ZSHRC_CONTENT,
} from '../../shell/guarded-shell';
import {
  GUARDED_SHELL_PATH,
  ZDOT_DIR,
} from '../../legacy';

describe('GUARDED_SHELL_CONTENT', () => {
  it('starts with #!/bin/zsh shebang', () => {
    expect(GUARDED_SHELL_CONTENT.startsWith('#!/bin/zsh')).toBe(true);
  });

  it('contains ZDOTDIR export', () => {
    expect(GUARDED_SHELL_CONTENT).toContain('ZDOTDIR');
  });

  it('contains exec /bin/zsh', () => {
    expect(GUARDED_SHELL_CONTENT).toContain('exec /bin/zsh');
  });

  it('unsets dangerous environment variables', () => {
    expect(GUARDED_SHELL_CONTENT).toContain('unset DYLD_LIBRARY_PATH');
    expect(GUARDED_SHELL_CONTENT).toContain('unset PYTHONPATH');
    expect(GUARDED_SHELL_CONTENT).toContain('unset SSH_ASKPASS');
  });

  it('resolves the per-target ZDOTDIR from the agent home', () => {
    expect(GUARDED_SHELL_CONTENT).toContain('.zdot');
  });
});

describe('guardedShellPath', () => {
  it('returns correct per-target path', () => {
    const result = guardedShellPath('/Users/ash_test_agent');

    expect(result).toBe(
      '/Users/ash_test_agent/.agenshield/bin/guarded-shell',
    );
  });

  it('handles different agent home paths', () => {
    const result = guardedShellPath('/Users/ash_myapp_agent');

    expect(result).toBe(
      '/Users/ash_myapp_agent/.agenshield/bin/guarded-shell',
    );
  });
});

describe('GUARDED_SHELL_PATH (legacy)', () => {
  it('points to /usr/local/bin/guarded-shell', () => {
    expect(GUARDED_SHELL_PATH).toBe('/usr/local/bin/guarded-shell');
  });
});

describe('zdotDir', () => {
  it('returns correct per-target ZDOTDIR path', () => {
    const result = zdotDir('/Users/ash_test_agent');

    expect(result).toBe('/Users/ash_test_agent/.zdot');
  });

  it('returns different path for different agent homes', () => {
    expect(zdotDir('/Users/ash_a_agent')).not.toBe(
      zdotDir('/Users/ash_b_agent'),
    );
  });
});

describe('ZDOT_DIR (legacy)', () => {
  it('points to /etc/agenshield/zdot', () => {
    expect(ZDOT_DIR).toBe('/etc/agenshield/zdot');
  });
});

describe('zdotZshenvContent', () => {
  it('includes the agent home path in SHELL export', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain(
      '/Users/ash_test_agent/.agenshield/bin/guarded-shell',
    );
  });

  it('contains PATH setup with $HOME/bin', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('$HOME/bin');
  });

  it('contains NVM initialization', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('NVM_DIR');
    expect(content).toContain('nvm.sh');
  });

  it('contains NO_GLOBAL_RCS to skip system rc files', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('NO_GLOBAL_RCS');
  });

  it('unsets dangerous environment variables', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('unset DYLD_LIBRARY_PATH');
    expect(content).toContain('unset PYTHONPATH');
  });
});

describe('ZDOT_ZSHRC_CONTENT', () => {
  it('contains shell restriction setup', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('emulate -LR zsh');
  });

  it('locks critical variables as readonly', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('typeset -r PATH HOME SHELL');
  });

  it('contains TRAPDEBUG enforcement hook', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('TRAPDEBUG');
  });

  it('disables dangerous builtins', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('disable -r');
    expect(ZDOT_ZSHRC_CONTENT).toContain('exec');
    expect(ZDOT_ZSHRC_CONTENT).toContain('eval');
  });

  it('contains deny function for policy enforcement', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('deny()');
    expect(ZDOT_ZSHRC_CONTENT).toContain('Denied by policy');
  });

  it('contains is_allowed_cmd function', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('is_allowed_cmd()');
  });
});

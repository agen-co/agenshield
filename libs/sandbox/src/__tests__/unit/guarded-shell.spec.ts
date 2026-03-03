import {
  GUARDED_SHELL_CONTENT,
  guardedShellPath,
  zdotDir,
  zdotZshenvContent,
  zdotZshrcContent,
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

  it('contains NVM initialization when nvm feature enabled', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent', { nvm: true });

    expect(content).toContain('NVM_DIR');
  });

  it('omits NVM initialization by default', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).not.toContain('NVM_DIR');
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

  it('contains TRAPDEBUG enforcement hook', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('TRAPDEBUG');
  });

  it('disables dangerous builtins', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('disable -r');
    expect(content).toContain('exec');
    expect(content).toContain('eval');
  });

  it('contains deny function for policy enforcement', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('deny()');
    expect(content).toContain('Denied by policy');
  });

  it('contains is_allowed_cmd function', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('is_allowed_cmd()');
  });

  it('allows setopt and unsetopt in is_allowed_cmd', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    // setopt/unsetopt are needed by .zshenv (NO_GLOBAL_RCS) and .zshrc (NO_CASE_GLOB, NO_BEEP)
    expect(content).toContain('setopt|unsetopt)');
  });

  it('locks critical variables as readonly', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    expect(content).toContain('typeset -r PATH HOME SHELL');
  });

  it('blocks direct path execution in non-interactive shells', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent');

    // TRAPDEBUG must catch /usr/bin/* patterns
    expect(content).toContain('*/*');
    expect(content).toContain('Denied: direct path execution');
  });

  it('includes homebrew path checks when homebrew feature enabled', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent', { homebrew: true });

    expect(content).toContain('homebrew/bin');
    expect(content).toContain('HOMEBREW_PREFIX');
  });

  it('includes NVM path checks in is_allowed_cmd when nvm feature enabled', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent', { nvm: true });

    expect(content).toContain('.nvm/');
    expect(content).toContain('NVM_DIR');
  });

  it('includes proxy env vars when proxy feature enabled', () => {
    const content = zdotZshenvContent('/Users/ash_test_agent', { proxy: true });

    expect(content).toContain('HTTP_PROXY');
    expect(content).toContain('HTTPS_PROXY');
  });
});

describe('zdotZshrcContent', () => {
  it('contains shell restriction setup', () => {
    const content = zdotZshrcContent();

    expect(content).toContain('emulate -LR zsh');
  });

  it('re-asserts readonly variables for defense-in-depth', () => {
    const content = zdotZshrcContent();

    expect(content).toContain('typeset -r PATH HOME SHELL');
  });

  it('does NOT contain TRAPDEBUG (moved to .zshenv)', () => {
    const content = zdotZshrcContent();

    expect(content).not.toContain('TRAPDEBUG');
  });

  it('does NOT contain is_allowed_cmd (moved to .zshenv)', () => {
    const content = zdotZshrcContent();

    expect(content).not.toContain('is_allowed_cmd');
  });

  it('does NOT contain deny function (moved to .zshenv)', () => {
    const content = zdotZshrcContent();

    expect(content).not.toContain('deny()');
  });

  it('does NOT contain disable builtins (moved to .zshenv)', () => {
    const content = zdotZshrcContent();

    expect(content).not.toContain('disable -r');
    expect(content).not.toContain('disable eval');
  });

  it('contains preexec hook for interactive shells', () => {
    const content = zdotZshrcContent();

    expect(content).toContain('preexec()');
  });

  it('contains working directory setup', () => {
    const content = zdotZshrcContent();

    expect(content).toContain('AGENSHIELD_HOST_CWD');
  });

  it('contains shell options', () => {
    const content = zdotZshrcContent();

    expect(content).toContain('NO_CASE_GLOB');
    expect(content).toContain('NO_BEEP');
  });
});

describe('ZDOT_ZSHRC_CONTENT (legacy)', () => {
  it('contains shell restriction setup', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('emulate -LR zsh');
  });

  it('re-asserts readonly variables', () => {
    expect(ZDOT_ZSHRC_CONTENT).toContain('typeset -r PATH HOME SHELL');
  });
});

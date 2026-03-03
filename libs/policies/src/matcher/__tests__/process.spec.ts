/**
 * Process pattern matching — unit tests
 */

import { matchProcessPattern } from '../process';

describe('matchProcessPattern', () => {
  describe('wildcard *', () => {
    it('matches any process', () => {
      expect(matchProcessPattern('*', '/usr/bin/node server.js')).toBe(true);
    });

    it('matches simple basename', () => {
      expect(matchProcessPattern('*', 'openclaw')).toBe(true);
    });
  });

  describe(':* suffix (prefix matching)', () => {
    it('matches exact basename without args', () => {
      expect(matchProcessPattern('node:*', 'node')).toBe(true);
    });

    it('matches basename with args', () => {
      expect(matchProcessPattern('node:*', 'node server.js --port 3000')).toBe(true);
    });

    it('matches full path extracting basename', () => {
      expect(matchProcessPattern('node:*', '/usr/local/bin/node server.js')).toBe(true);
    });

    it('does not match different process', () => {
      expect(matchProcessPattern('node:*', 'python app.py')).toBe(false);
    });
  });

  describe('glob patterns with *', () => {
    it('*claude* matches command containing claude', () => {
      expect(matchProcessPattern('*claude*', '/Users/david/.claude/local/claude server.js')).toBe(true);
    });

    it('*openclaw* matches command containing openclaw', () => {
      expect(matchProcessPattern('*openclaw*', '/opt/openclaw/bin/openclaw-server --daemon')).toBe(true);
    });

    it('*openclaw* does not match unrelated command', () => {
      expect(matchProcessPattern('*openclaw*', '/usr/bin/node app.js')).toBe(false);
    });

    it('node* matches commands starting with node', () => {
      expect(matchProcessPattern('node*', 'node-gyp build')).toBe(true);
    });

    it('*openclaw* should NOT match rg searching in openclaw directory', () => {
      expect(matchProcessPattern('*openclaw*', 'rg --files /path/to/openclaw/dir')).toBe(false);
    });

    it('*openclaw* should NOT match grep searching in openclaw path', () => {
      expect(matchProcessPattern('*openclaw*', 'grep -r something /presets/openclaw/file.ts')).toBe(false);
    });

    it('*openclaw* SHOULD match openclaw binary with full path', () => {
      expect(matchProcessPattern('*openclaw*', '/usr/bin/openclaw --flag')).toBe(true);
    });

    it('*openclaw* SHOULD match bare openclaw command', () => {
      expect(matchProcessPattern('*openclaw*', 'openclaw')).toBe(true);
    });

    it('*openclaw* matches via interpreter script candidate', () => {
      expect(matchProcessPattern('*openclaw*', 'node /path/to/node_modules/openclaw/bin/cli.js')).toBe(true);
    });
  });

  describe('exact basename match', () => {
    it('matches basename from full path', () => {
      expect(matchProcessPattern('openclaw', '/usr/bin/openclaw')).toBe(true);
    });

    it('matches simple command', () => {
      expect(matchProcessPattern('openclaw', 'openclaw')).toBe(true);
    });

    it('case-insensitive matching', () => {
      expect(matchProcessPattern('OpenClaw', 'openclaw')).toBe(true);
    });

    it('matches basename even when args are present', () => {
      expect(matchProcessPattern('openclaw', 'openclaw --daemon')).toBe(true);
    });

    it('does not match different command', () => {
      expect(matchProcessPattern('openclaw', 'node server.js')).toBe(false);
    });
  });

  describe('interpreter-aware matching', () => {
    describe('exact match via script candidates', () => {
      it('matches package dir from node_modules path', () => {
        expect(matchProcessPattern(
          'openclaw',
          'node /Users/david/.nvm/versions/node/v24/lib/node_modules/openclaw/bin/dummy-openclaw.js',
        )).toBe(true);
      });

      it('matches script basename without extension', () => {
        expect(matchProcessPattern(
          'dummy-openclaw',
          'node /path/to/node_modules/openclaw/bin/dummy-openclaw.js',
        )).toBe(true);
      });

      it('matches with full interpreter path', () => {
        expect(matchProcessPattern(
          'openclaw',
          '/usr/local/bin/node /path/to/node_modules/openclaw/bin/index.js',
        )).toBe(true);
      });

      it('skips flags to find script argument', () => {
        expect(matchProcessPattern(
          'openclaw',
          'node --inspect --max-old-space-size=4096 /path/to/node_modules/openclaw/bin/cli.js',
        )).toBe(true);
      });

      it('case-insensitive matching on candidates', () => {
        expect(matchProcessPattern(
          'OpenClaw',
          'node /path/to/node_modules/openclaw/bin/cli.js',
        )).toBe(true);
      });

      it('works with python interpreter', () => {
        expect(matchProcessPattern(
          'my-tool',
          'python3 /usr/local/lib/python3.11/site-packages/my-tool/cli.py',
        )).toBe(true);
      });

      it('works with bun interpreter', () => {
        expect(matchProcessPattern(
          'openclaw',
          'bun /path/to/node_modules/openclaw/bin/cli.js',
        )).toBe(true);
      });

      it('does not match when script has no relevant candidate', () => {
        expect(matchProcessPattern(
          'openclaw',
          'node /path/to/unrelated/server.js',
        )).toBe(false);
      });
    });

    describe(':* suffix with interpreter candidates', () => {
      it('matches package dir with :* suffix', () => {
        expect(matchProcessPattern(
          'openclaw:*',
          'node /path/to/node_modules/openclaw/bin/dummy-openclaw.js --port 3000',
        )).toBe(true);
      });

      it('matches script basename with :* suffix', () => {
        expect(matchProcessPattern(
          'dummy-openclaw:*',
          'node /path/to/node_modules/openclaw/bin/dummy-openclaw.js --serve',
        )).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('returns false for interpreter with no script arg', () => {
        expect(matchProcessPattern('openclaw', 'node')).toBe(false);
      });

      it('returns false for interpreter with only flags', () => {
        expect(matchProcessPattern('openclaw', 'node --version')).toBe(false);
      });

      it('does not trigger interpreter logic for unknown executables', () => {
        expect(matchProcessPattern(
          'openclaw',
          'myruntime /path/to/node_modules/openclaw/bin/cli.js',
        )).toBe(false);
      });

      it('handles relative script path', () => {
        expect(matchProcessPattern(
          'my-script',
          'node ./my-script.js',
        )).toBe(true);
      });

      it('handles script without extension', () => {
        expect(matchProcessPattern(
          'my-script',
          'node my-script',
        )).toBe(true);
      });
    });
  });

  describe('real-world patterns', () => {
    it('matches claude-code binary', () => {
      expect(matchProcessPattern('*claude*', '/Users/david/.nvm/versions/node/v20/bin/claude')).toBe(true);
    });

    it('matches openclaw with args', () => {
      expect(matchProcessPattern('openclaw:*', '/opt/openclaw/bin/openclaw serve --port 8080')).toBe(true);
    });

    it('does not match node script in openclaw directory (glob matches binary, not args)', () => {
      expect(matchProcessPattern('*openclaw*', 'node /opt/openclaw/dist/index.js')).toBe(false);
    });
  });
});

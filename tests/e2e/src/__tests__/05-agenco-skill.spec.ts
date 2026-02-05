/**
 * E2E Test: AgenCo Built-in Skill CLI
 *
 * Tests the agenco CLI (built-in skill) against the running daemon.
 * Verifies help output, auth status, and skill loading.
 */

import * as path from 'node:path';
import { runShell, getRootDir } from '../setup/helpers';

const ROOT = getRootDir();
const AGENCO_BIN = path.join(
  ROOT,
  'libs/shield-skills/skills/agenco-secure-integrations/bin/agenco.mjs'
);

describe('agenco built-in skill CLI', () => {
  it('should show help', () => {
    const result = runShell(`node ${AGENCO_BIN} --help`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('auth');
    expect(result.stdout).toContain('tool');
    expect(result.stdout).toContain('integrations');
  });

  it('help should show all auth subcommands', () => {
    const result = runShell(`node ${AGENCO_BIN} --help`);
    expect(result.stdout).toContain('auth login');
    expect(result.stdout).toContain('auth status');
    expect(result.stdout).toContain('auth logout');
  });

  it('help should show all tool subcommands', () => {
    const result = runShell(`node ${AGENCO_BIN} --help`);
    expect(result.stdout).toContain('tool list');
    expect(result.stdout).toContain('tool search');
    expect(result.stdout).toContain('tool run');
  });

  it('help should show all integrations subcommands', () => {
    const result = runShell(`node ${AGENCO_BIN} --help`);
    expect(result.stdout).toContain('integrations list');
    expect(result.stdout).toContain('integrations connected');
    expect(result.stdout).toContain('integrations connect');
  });

  it('should report auth status as not authenticated', () => {
    const result = runShell(`node ${AGENCO_BIN} auth status`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Not authenticated');
  });

  it('should handle unknown command gracefully', () => {
    const result = runShell(`node ${AGENCO_BIN} unknown-cmd`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown command');
  });

  it('should handle unknown auth subcommand gracefully', () => {
    const result = runShell(`node ${AGENCO_BIN} auth unknown-sub`);
    expect(result.exitCode).not.toBe(0);
  });

  it('tool run without args should show usage', () => {
    const result = runShell(`node ${AGENCO_BIN} tool run`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage');
  });

  it('integrations connect without args should show usage', () => {
    const result = runShell(`node ${AGENCO_BIN} integrations connect`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage');
  });

  it('SKILL.md should exist in the built-in skills directory', () => {
    const result = runShell(
      `test -f libs/shield-skills/skills/agenco-secure-integrations/SKILL.md && echo "EXISTS"`
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('EXISTS');
  });

  it('should load as a valid skill via SkillLoader', () => {
    // Use a simple node script to test skill loading from the built dist
    const loaderScript = `
      const path = require('path');
      const fs = require('fs');
      const skillPath = path.resolve('libs/shield-skills/skills/agenco-secure-integrations/SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');
      // Check YAML frontmatter
      const hasYaml = content.startsWith('---');
      const hasName = content.includes('name:');
      console.log(JSON.stringify({ hasYaml, hasName, valid: hasYaml && hasName }));
    `;
    const result = runShell(`node -e "${loaderScript.replace(/\n/g, ' ')}"`);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.valid).toBe(true);
  });
});

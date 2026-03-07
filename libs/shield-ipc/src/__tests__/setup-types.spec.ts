import {
  getShieldStepsForPreset,
  CLAUDE_CODE_SHIELD_STEPS,
  OPENCLAW_SHIELD_STEPS,
  SHIELD_PHASE_LABELS,
  backupConfigPath,
} from '@agenshield/ipc';

describe('getShieldStepsForPreset', () => {
  it('returns CLAUDE_CODE_SHIELD_STEPS for "claude-code"', () => {
    const steps = getShieldStepsForPreset('claude-code');
    expect(steps).toBe(CLAUDE_CODE_SHIELD_STEPS);
  });

  it('returns OPENCLAW_SHIELD_STEPS for "openclaw"', () => {
    const steps = getShieldStepsForPreset('openclaw');
    expect(steps).toBe(OPENCLAW_SHIELD_STEPS);
  });

  it('returns OPENCLAW_SHIELD_STEPS as default for unknown preset', () => {
    const steps = getShieldStepsForPreset('anything-else');
    expect(steps).toBe(OPENCLAW_SHIELD_STEPS);
  });

  it('CLAUDE_CODE_SHIELD_STEPS has expected count', () => {
    expect(CLAUDE_CODE_SHIELD_STEPS.length).toBeGreaterThan(30);
  });

  it('OPENCLAW_SHIELD_STEPS has expected count', () => {
    expect(OPENCLAW_SHIELD_STEPS.length).toBeGreaterThan(30);
  });

  it('each step has required fields', () => {
    for (const step of CLAUDE_CODE_SHIELD_STEPS) {
      expect(step).toHaveProperty('id');
      expect(step).toHaveProperty('phase');
      expect(step).toHaveProperty('name');
      expect(step).toHaveProperty('description');
      expect(typeof step.phase).toBe('number');
    }
  });
});

describe('SHIELD_PHASE_LABELS', () => {
  it('has entries for phases 0 through 14', () => {
    for (let i = 0; i <= 14; i++) {
      expect(SHIELD_PHASE_LABELS[i]).toBeDefined();
      expect(typeof SHIELD_PHASE_LABELS[i]).toBe('string');
    }
  });
});

describe('backupConfigPath', () => {
  it('returns path ending in backup.json', () => {
    const p = backupConfigPath('/some/home');
    expect(p).toMatch(/backup\.json$/);
  });

  it('uses custom home when provided', () => {
    expect(backupConfigPath('/custom/home')).toBe('/custom/home/.agenshield/backup.json');
  });

  it('uses env fallback when no arg', () => {
    const p = backupConfigPath();
    expect(p).toContain('.agenshield/backup.json');
  });

  it('falls back to empty string when no home and no env vars', () => {
    const origEnv = { ...process.env };
    delete process.env['AGENSHIELD_USER_HOME'];
    delete process.env['HOME'];
    const p = backupConfigPath();
    expect(p).toBe('/.agenshield/backup.json');
    process.env = origEnv;
  });
});

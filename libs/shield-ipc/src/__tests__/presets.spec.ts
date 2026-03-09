import {
  getPresetById,
  PRESET_MAP,
  POLICY_PRESETS,
  OPENCLAW_PRESET,
  AGENCO_PRESET,
  CLAUDECODE_PRESET,
} from '@agenshield/ipc';

describe('getPresetById', () => {
  it('returns OPENCLAW_PRESET for "openclaw"', () => {
    expect(getPresetById('openclaw')).toBe(OPENCLAW_PRESET);
  });

  it('returns AGENCO_PRESET for "agenco"', () => {
    expect(getPresetById('agenco')).toBe(AGENCO_PRESET);
  });

  it('returns CLAUDECODE_PRESET for "claudecode"', () => {
    expect(getPresetById('claudecode')).toBe(CLAUDECODE_PRESET);
  });

  it('returns undefined for unknown preset', () => {
    expect(getPresetById('unknown')).toBeUndefined();
  });
});

describe('PRESET_MAP', () => {
  it('has exactly 3 keys', () => {
    expect(Object.keys(PRESET_MAP)).toHaveLength(3);
  });
});

describe('POLICY_PRESETS', () => {
  it('is an array of length 3', () => {
    expect(POLICY_PRESETS).toHaveLength(3);
  });

  it('each preset has required fields', () => {
    for (const preset of POLICY_PRESETS) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('description');
      expect(preset).toHaveProperty('policies');
      expect(Array.isArray(preset.policies)).toBe(true);
      expect(preset.policies.length).toBeGreaterThan(0);
    }
  });
});

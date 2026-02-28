/**
 * Policy presets — data integrity tests
 */

import {
  POLICY_PRESETS,
  PRESET_MAP,
  OPENCLAW_PRESET,
  CLAUDECODE_PRESET,
  AGENCO_PRESET,
  getPresetById,
} from '../presets';
import type { PolicyPreset } from '../presets';

describe('POLICY_PRESETS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(POLICY_PRESETS)).toBe(true);
    expect(POLICY_PRESETS.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = POLICY_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each preset has required shape', () => {
    for (const preset of POLICY_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(Array.isArray(preset.policies)).toBe(true);
      expect(preset.policies.length).toBeGreaterThan(0);
    }
  });

  it('each preset policy has required fields', () => {
    for (const preset of POLICY_PRESETS) {
      for (const policy of preset.policies) {
        expect(policy.id).toBeTruthy();
        expect(policy.name).toBeTruthy();
        expect(['allow', 'deny']).toContain(policy.action);
        expect(['url', 'command', 'filesystem']).toContain(policy.target);
        expect(Array.isArray(policy.patterns)).toBe(true);
        expect(policy.patterns.length).toBeGreaterThan(0);
        expect(policy.enabled).toBe(true);
      }
    }
  });

  it('contains exactly 3 presets', () => {
    expect(POLICY_PRESETS).toHaveLength(3);
  });
});

describe('PRESET_MAP', () => {
  it('keys match POLICY_PRESETS ids', () => {
    const mapKeys = Object.keys(PRESET_MAP).sort();
    const presetIds = POLICY_PRESETS.map(p => p.id).sort();
    expect(mapKeys).toEqual(presetIds);
  });

  it('values reference the same preset objects', () => {
    expect(PRESET_MAP['openclaw']).toBe(OPENCLAW_PRESET);
    expect(PRESET_MAP['agenco']).toBe(AGENCO_PRESET);
    expect(PRESET_MAP['claudecode']).toBe(CLAUDECODE_PRESET);
  });

  it('contains all named constants', () => {
    expect(PRESET_MAP).toHaveProperty('openclaw');
    expect(PRESET_MAP).toHaveProperty('agenco');
    expect(PRESET_MAP).toHaveProperty('claudecode');
  });
});

describe('getPresetById', () => {
  it('returns openclaw preset', () => {
    expect(getPresetById('openclaw')).toBe(OPENCLAW_PRESET);
  });

  it('returns agenco preset', () => {
    expect(getPresetById('agenco')).toBe(AGENCO_PRESET);
  });

  it('returns claudecode preset', () => {
    expect(getPresetById('claudecode')).toBe(CLAUDECODE_PRESET);
  });

  it('returns undefined for unknown id', () => {
    expect(getPresetById('nonexistent')).toBeUndefined();
  });
});

describe('OPENCLAW_PRESET', () => {
  it('has AI API urls', () => {
    const aiApis = OPENCLAW_PRESET.policies.find(p => p.id === 'preset-openclaw-ai-apis');
    expect(aiApis).toBeDefined();
    expect(aiApis!.patterns).toContain('api.openai.com');
    expect(aiApis!.patterns).toContain('api.anthropic.com');
  });

  it('has package registries', () => {
    const registries = OPENCLAW_PRESET.policies.find(p => p.id === 'preset-openclaw-registries');
    expect(registries).toBeDefined();
    expect(registries!.patterns).toContain('registry.npmjs.org');
    expect(registries!.patterns).toContain('github.com');
  });

  it('has command patterns', () => {
    const commands = OPENCLAW_PRESET.policies.find(p => p.id === 'preset-openclaw-commands');
    expect(commands).toBeDefined();
    expect(commands!.target).toBe('command');
    expect(commands!.patterns).toContain('node:*');
    expect(commands!.patterns).toContain('git:*');
    expect(commands!.patterns).toContain('launchctl:*');
  });
});

describe('CLAUDECODE_PRESET', () => {
  it('has claude command pattern', () => {
    const commands = CLAUDECODE_PRESET.policies.find(p => p.id === 'preset-cc-commands');
    expect(commands).toBeDefined();
    expect(commands!.patterns).toContain('claude:*');
  });

  it('has workspace filesystem access', () => {
    const fs = CLAUDECODE_PRESET.policies.find(p => p.id === 'preset-cc-filesystem');
    expect(fs).toBeDefined();
    expect(fs!.target).toBe('filesystem');
    expect(fs!.patterns).toContain('$WORKSPACE/**');
  });
});

describe('AGENCO_PRESET', () => {
  it('has agenco command pattern', () => {
    const commands = AGENCO_PRESET.policies.find(p => p.id === 'preset-agenco-commands');
    expect(commands).toBeDefined();
    expect(commands!.patterns).toContain('agenco:*');
  });

  it('has marketplace URL', () => {
    const urls = AGENCO_PRESET.policies.find(p => p.id === 'preset-agenco-urls');
    expect(urls).toBeDefined();
    expect(urls!.patterns).toContain('mcp.marketplace.frontegg.com');
  });
});

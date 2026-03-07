import {
  resolveNavigationTarget,
  isAlertWorthy,
  interpolateTemplate,
  ALERT_RULES,
} from '@agenshield/ipc';

describe('resolveNavigationTarget', () => {
  it('resolves skills channel to /skills', () => {
    expect(resolveNavigationTarget('skills:quarantined')).toBe('/skills');
  });

  it('resolves exec channel to /policies', () => {
    expect(resolveNavigationTarget('exec:denied')).toBe('/policies');
  });

  it('resolves interceptor channel to /policies', () => {
    expect(resolveNavigationTarget('interceptor:blocked')).toBe('/policies');
  });

  it('resolves security channel to /settings', () => {
    expect(resolveNavigationTarget('security:critical')).toBe('/settings');
  });

  it('returns / for unknown channel', () => {
    expect(resolveNavigationTarget('unknown:event')).toBe('/');
  });

  it('returns / for event type without colon', () => {
    expect(resolveNavigationTarget('nocolon')).toBe('/');
  });
});

describe('isAlertWorthy', () => {
  it('returns true for all known alert event types', () => {
    for (const eventType of Object.keys(ALERT_RULES)) {
      expect(isAlertWorthy(eventType)).toBe(true);
    }
  });

  it('returns false for unknown event type', () => {
    expect(isAlertWorthy('unknown:event')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAlertWorthy('')).toBe(false);
  });
});

describe('interpolateTemplate', () => {
  it('returns template unchanged when no placeholders', () => {
    expect(interpolateTemplate('Hello world', {})).toBe('Hello world');
  });

  it('replaces single placeholder with matching data', () => {
    expect(interpolateTemplate('{name} was quarantined', { name: 'my-skill' })).toBe(
      'my-skill was quarantined',
    );
  });

  it('replaces multiple placeholders', () => {
    const result = interpolateTemplate('Command "{command}" denied: {reason}.', {
      command: 'rm -rf',
      reason: 'policy violation',
    });
    expect(result).toBe('Command "rm -rf" denied: policy violation.');
  });

  it('keeps placeholder when field is missing in data', () => {
    expect(interpolateTemplate('{missing} field', { other: 'value' })).toBe('{missing} field');
  });

  it('returns template unchanged when data is null', () => {
    expect(interpolateTemplate('{name}', null)).toBe('{name}');
  });

  it('returns template unchanged when data is a string', () => {
    expect(interpolateTemplate('{name}', 'not-an-object' as unknown)).toBe('{name}');
  });

  it('returns template unchanged when data is a number', () => {
    expect(interpolateTemplate('{name}', 42 as unknown)).toBe('{name}');
  });

  it('keeps placeholder when field value is undefined', () => {
    expect(interpolateTemplate('{name}', { name: undefined })).toBe('{name}');
  });

  it('keeps placeholder when field value is null', () => {
    expect(interpolateTemplate('{name}', { name: null })).toBe('{name}');
  });

  it('converts non-string values to string', () => {
    expect(interpolateTemplate('{count} items', { count: 42 })).toBe('42 items');
  });
});

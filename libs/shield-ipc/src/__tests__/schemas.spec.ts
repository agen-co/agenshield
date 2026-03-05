import {
  CreateActivityEventSchema,
  CreateAlertSchema,
  CreateAllowedCommandSchema,
  PolicyConfigSchema,
  CreateSkillFileSchema,
  CreateEdgeActivationSchema,
} from '@agenshield/ipc';

describe('CreateActivityEventSchema', () => {
  it('parses valid input', () => {
    const result = CreateActivityEventSchema.parse({
      type: 'policy.check',
      timestamp: '2026-01-01T00:00:00Z',
      data: { foo: 'bar' },
    });
    expect(result.type).toBe('policy.check');
    expect(result.timestamp).toBe('2026-01-01T00:00:00Z');
  });

  it('accepts optional fields', () => {
    const result = CreateActivityEventSchema.parse({
      type: 'exec.run',
      timestamp: '2026-01-01T00:00:00Z',
      data: null,
      profileId: 'prof-1',
      source: 'cli',
    });
    expect(result.profileId).toBe('prof-1');
    expect(result.source).toBe('cli');
  });

  it('rejects missing type', () => {
    expect(() =>
      CreateActivityEventSchema.parse({
        timestamp: '2026-01-01T00:00:00Z',
        data: null,
      }),
    ).toThrow();
  });

  it('rejects invalid timestamp', () => {
    expect(() =>
      CreateActivityEventSchema.parse({
        type: 'test',
        timestamp: 'not-a-date',
        data: null,
      }),
    ).toThrow();
  });
});

describe('CreateAlertSchema', () => {
  const validAlert = {
    activityEventId: 1,
    eventType: 'policy.denied',
    severity: 'warning' as const,
    title: 'Blocked request',
    description: 'A request was blocked by policy',
    navigationTarget: '/policies/123',
  };

  it('parses valid input', () => {
    const result = CreateAlertSchema.parse(validAlert);
    expect(result.severity).toBe('warning');
    expect(result.title).toBe('Blocked request');
  });

  it('accepts optional fields', () => {
    const result = CreateAlertSchema.parse({
      ...validAlert,
      profileId: 'prof-1',
      details: { extra: true },
    });
    expect(result.profileId).toBe('prof-1');
  });

  it('rejects invalid severity', () => {
    expect(() =>
      CreateAlertSchema.parse({ ...validAlert, severity: 'unknown' }),
    ).toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      CreateAlertSchema.parse({ ...validAlert, title: '' }),
    ).toThrow();
  });

  it('rejects non-positive activityEventId', () => {
    expect(() =>
      CreateAlertSchema.parse({ ...validAlert, activityEventId: 0 }),
    ).toThrow();
  });
});

describe('CreateAllowedCommandSchema', () => {
  it('parses valid input', () => {
    const result = CreateAllowedCommandSchema.parse({
      name: 'git',
      addedBy: 'user',
    });
    expect(result.name).toBe('git');
    expect(result.paths).toEqual([]);
  });

  it('applies default paths', () => {
    const result = CreateAllowedCommandSchema.parse({
      name: 'npm',
    });
    expect(result.paths).toEqual([]);
    expect(result.addedBy).toBe('policy');
  });

  it('accepts explicit paths', () => {
    const result = CreateAllowedCommandSchema.parse({
      name: 'node',
      paths: ['/usr/local/bin/node'],
    });
    expect(result.paths).toEqual(['/usr/local/bin/node']);
  });

  it('rejects empty name', () => {
    expect(() =>
      CreateAllowedCommandSchema.parse({ name: '' }),
    ).toThrow();
  });
});

describe('PolicyConfigSchema', () => {
  const validPolicy = {
    id: 'pol-1',
    name: 'Block shell',
    action: 'deny' as const,
    target: 'command' as const,
    patterns: ['rm -rf *'],
  };

  it('parses valid input', () => {
    const result = PolicyConfigSchema.parse(validPolicy);
    expect(result.action).toBe('deny');
    expect(result.enabled).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = PolicyConfigSchema.parse({
      ...validPolicy,
      enforcement: 'kill',
      priority: 10,
      operations: ['exec'],
      preset: 'strict',
      scope: 'workspace',
      networkAccess: 'none',
      methods: ['GET', 'POST'],
      tier: 'managed',
    });
    expect(result.enforcement).toBe('kill');
    expect(result.methods).toEqual(['GET', 'POST']);
  });

  it('rejects invalid action', () => {
    expect(() =>
      PolicyConfigSchema.parse({ ...validPolicy, action: 'block' }),
    ).toThrow();
  });

  it('rejects invalid target', () => {
    expect(() =>
      PolicyConfigSchema.parse({ ...validPolicy, target: 'database' }),
    ).toThrow();
  });

  it('rejects missing id', () => {
    expect(() =>
      PolicyConfigSchema.parse({ name: 'x', action: 'allow', target: 'url', patterns: [] }),
    ).toThrow();
  });
});

describe('CreateSkillFileSchema', () => {
  const validFile = {
    skillVersionId: '550e8400-e29b-41d4-a716-446655440000',
    relativePath: 'src/index.ts',
    fileHash: 'abc123',
    sizeBytes: 1024,
  };

  it('parses valid input', () => {
    const result = CreateSkillFileSchema.parse(validFile);
    expect(result.relativePath).toBe('src/index.ts');
    expect(result.sizeBytes).toBe(1024);
  });

  it('rejects empty relativePath', () => {
    expect(() =>
      CreateSkillFileSchema.parse({ ...validFile, relativePath: '' }),
    ).toThrow();
  });

  it('rejects negative sizeBytes', () => {
    expect(() =>
      CreateSkillFileSchema.parse({ ...validFile, sizeBytes: -1 }),
    ).toThrow();
  });

  it('rejects invalid uuid for skillVersionId', () => {
    expect(() =>
      CreateSkillFileSchema.parse({ ...validFile, skillVersionId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('CreateEdgeActivationSchema', () => {
  const validActivation = {
    edgeId: '550e8400-e29b-41d4-a716-446655440000',
    activatedAt: '2026-01-01T00:00:00Z',
  };

  it('parses valid input', () => {
    const result = CreateEdgeActivationSchema.parse(validActivation);
    expect(result.edgeId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.consumed).toBe(false);
  });

  it('accepts optional fields', () => {
    const result = CreateEdgeActivationSchema.parse({
      ...validActivation,
      expiresAt: '2026-12-31T23:59:59Z',
      processId: 1234,
      consumed: true,
    });
    expect(result.expiresAt).toBe('2026-12-31T23:59:59Z');
    expect(result.processId).toBe(1234);
    expect(result.consumed).toBe(true);
  });

  it('rejects invalid edgeId', () => {
    expect(() =>
      CreateEdgeActivationSchema.parse({ ...validActivation, edgeId: 'bad' }),
    ).toThrow();
  });

  it('rejects invalid activatedAt', () => {
    expect(() =>
      CreateEdgeActivationSchema.parse({ ...validActivation, activatedAt: 'nope' }),
    ).toThrow();
  });
});

import {
  SandboxError,
  InstallError,
  HomebrewInstallError,
  NvmInstallError,
  TargetAppInstallError,
  GuardedShellInstallError,
  StepExecutionError,
  GatewayPreflightError,
} from '../../errors';

describe('SandboxError', () => {
  it('creates an instance with the given message', () => {
    const err = new SandboxError('something broke');
    expect(err.message).toBe('something broke');
  });

  it('sets name to SandboxError', () => {
    const err = new SandboxError('msg');
    expect(err.name).toBe('SandboxError');
  });

  it('defaults code to SANDBOX_ERROR', () => {
    const err = new SandboxError('msg');
    expect(err.code).toBe('SANDBOX_ERROR');
  });

  it('accepts a custom code', () => {
    const err = new SandboxError('msg', 'CUSTOM_CODE');
    expect(err.code).toBe('CUSTOM_CODE');
  });

  it('is an instance of Error', () => {
    const err = new SandboxError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SandboxError);
  });

  it('has a stack trace', () => {
    const err = new SandboxError('msg');
    expect(err.stack).toBeDefined();
  });
});

describe('InstallError', () => {
  it('creates an instance with message, step, and targetId', () => {
    const err = new InstallError('install failed', 'setup', 'target-1');
    expect(err.message).toBe('install failed');
    expect(err.step).toBe('setup');
    expect(err.targetId).toBe('target-1');
  });

  it('sets name to InstallError', () => {
    const err = new InstallError('msg', 'step');
    expect(err.name).toBe('InstallError');
  });

  it('defaults code to INSTALL_ERROR', () => {
    const err = new InstallError('msg', 'step');
    expect(err.code).toBe('INSTALL_ERROR');
  });

  it('accepts a custom code', () => {
    const err = new InstallError('msg', 'step', undefined, 'CUSTOM');
    expect(err.code).toBe('CUSTOM');
  });

  it('leaves targetId undefined when not provided', () => {
    const err = new InstallError('msg', 'step');
    expect(err.targetId).toBeUndefined();
  });

  it('extends SandboxError and Error', () => {
    const err = new InstallError('msg', 'step');
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new InstallError('msg', 'step');
    expect(err.stack).toBeDefined();
  });
});

describe('HomebrewInstallError', () => {
  it('creates an instance with the given message', () => {
    const err = new HomebrewInstallError('brew failed');
    expect(err.message).toBe('brew failed');
  });

  it('sets name to HomebrewInstallError', () => {
    const err = new HomebrewInstallError('msg');
    expect(err.name).toBe('HomebrewInstallError');
  });

  it('sets code to HOMEBREW_INSTALL_ERROR', () => {
    const err = new HomebrewInstallError('msg');
    expect(err.code).toBe('HOMEBREW_INSTALL_ERROR');
  });

  it('sets step to homebrew', () => {
    const err = new HomebrewInstallError('msg');
    expect(err.step).toBe('homebrew');
  });

  it('has targetId undefined', () => {
    const err = new HomebrewInstallError('msg');
    expect(err.targetId).toBeUndefined();
  });

  it('extends InstallError, SandboxError, and Error', () => {
    const err = new HomebrewInstallError('msg');
    expect(err).toBeInstanceOf(HomebrewInstallError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new HomebrewInstallError('msg');
    expect(err.stack).toBeDefined();
  });
});

describe('NvmInstallError', () => {
  it('creates an instance with the given message', () => {
    const err = new NvmInstallError('nvm failed');
    expect(err.message).toBe('nvm failed');
  });

  it('sets name to NvmInstallError', () => {
    const err = new NvmInstallError('msg');
    expect(err.name).toBe('NvmInstallError');
  });

  it('sets code to NVM_INSTALL_ERROR', () => {
    const err = new NvmInstallError('msg');
    expect(err.code).toBe('NVM_INSTALL_ERROR');
  });

  it('sets step to nvm', () => {
    const err = new NvmInstallError('msg');
    expect(err.step).toBe('nvm');
  });

  it('has targetId undefined', () => {
    const err = new NvmInstallError('msg');
    expect(err.targetId).toBeUndefined();
  });

  it('extends InstallError, SandboxError, and Error', () => {
    const err = new NvmInstallError('msg');
    expect(err).toBeInstanceOf(NvmInstallError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new NvmInstallError('msg');
    expect(err.stack).toBeDefined();
  });
});

describe('TargetAppInstallError', () => {
  it('creates an instance with message and appName', () => {
    const err = new TargetAppInstallError('app install failed', 'MyApp');
    expect(err.message).toBe('app install failed');
    expect(err.appName).toBe('MyApp');
  });

  it('sets name to TargetAppInstallError', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err.name).toBe('TargetAppInstallError');
  });

  it('sets code to TARGET_APP_INSTALL_ERROR', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err.code).toBe('TARGET_APP_INSTALL_ERROR');
  });

  it('sets step to install_app', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err.step).toBe('install_app');
  });

  it('has targetId undefined', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err.targetId).toBeUndefined();
  });

  it('extends InstallError, SandboxError, and Error', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err).toBeInstanceOf(TargetAppInstallError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new TargetAppInstallError('msg', 'App');
    expect(err.stack).toBeDefined();
  });
});

describe('GuardedShellInstallError', () => {
  it('creates an instance with the given message', () => {
    const err = new GuardedShellInstallError('guarded shell failed');
    expect(err.message).toBe('guarded shell failed');
  });

  it('sets name to GuardedShellInstallError', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err.name).toBe('GuardedShellInstallError');
  });

  it('sets code to GUARDED_SHELL_INSTALL_ERROR', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err.code).toBe('GUARDED_SHELL_INSTALL_ERROR');
  });

  it('sets step to guarded_shell', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err.step).toBe('guarded_shell');
  });

  it('has targetId undefined', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err.targetId).toBeUndefined();
  });

  it('extends InstallError, SandboxError, and Error', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err).toBeInstanceOf(GuardedShellInstallError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new GuardedShellInstallError('msg');
    expect(err.stack).toBeDefined();
  });
});

describe('StepExecutionError', () => {
  it('creates an instance with message, stepId, and stepName', () => {
    const err = new StepExecutionError('step failed', 'step-42', 'Install Dependencies');
    expect(err.message).toBe('step failed');
    expect(err.step).toBe('step-42');
    expect(err.stepName).toBe('Install Dependencies');
  });

  it('sets name to StepExecutionError', () => {
    const err = new StepExecutionError('msg', 'id', 'name');
    expect(err.name).toBe('StepExecutionError');
  });

  it('sets code to STEP_EXECUTION_ERROR', () => {
    const err = new StepExecutionError('msg', 'id', 'name');
    expect(err.code).toBe('STEP_EXECUTION_ERROR');
  });

  it('passes stepId as the step property via InstallError', () => {
    const err = new StepExecutionError('msg', 'my-step-id', 'My Step');
    expect(err.step).toBe('my-step-id');
  });

  it('has targetId undefined', () => {
    const err = new StepExecutionError('msg', 'id', 'name');
    expect(err.targetId).toBeUndefined();
  });

  it('extends InstallError, SandboxError, and Error', () => {
    const err = new StepExecutionError('msg', 'id', 'name');
    expect(err).toBeInstanceOf(StepExecutionError);
    expect(err).toBeInstanceOf(InstallError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new StepExecutionError('msg', 'id', 'name');
    expect(err.stack).toBeDefined();
  });
});

describe('GatewayPreflightError', () => {
  it('creates an instance with message and failures', () => {
    const failures = ['dns unreachable', 'port blocked'];
    const err = new GatewayPreflightError('preflight failed', failures);
    expect(err.message).toBe('preflight failed');
    expect(err.failures).toEqual(['dns unreachable', 'port blocked']);
  });

  it('sets name to GatewayPreflightError', () => {
    const err = new GatewayPreflightError('msg', []);
    expect(err.name).toBe('GatewayPreflightError');
  });

  it('sets code to GATEWAY_PREFLIGHT_ERROR', () => {
    const err = new GatewayPreflightError('msg', []);
    expect(err.code).toBe('GATEWAY_PREFLIGHT_ERROR');
  });

  it('stores an empty failures array', () => {
    const err = new GatewayPreflightError('msg', []);
    expect(err.failures).toEqual([]);
  });

  it('does not extend InstallError', () => {
    const err = new GatewayPreflightError('msg', ['fail']);
    expect(err).not.toBeInstanceOf(InstallError);
  });

  it('extends SandboxError and Error', () => {
    const err = new GatewayPreflightError('msg', ['fail']);
    expect(err).toBeInstanceOf(GatewayPreflightError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has a stack trace', () => {
    const err = new GatewayPreflightError('msg', []);
    expect(err.stack).toBeDefined();
  });
});

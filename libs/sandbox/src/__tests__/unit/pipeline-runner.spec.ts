import { runPipeline } from '../../presets/runner';
import type { InstallStep, PipelineState, StepResult, InstallContext } from '../../presets/types';

function createMockContext(overrides?: Partial<InstallContext>): InstallContext {
  return {
    agentHome: '/Users/ash_test_agent',
    agentUsername: 'ash_test_agent',
    socketGroupName: 'ash_test',
    hostUsername: 'testuser',
    hostHome: '/Users/testuser',
    profileBaseName: 'test',
    execAsRoot: jest.fn().mockResolvedValue({ success: true, stdout: '', stderr: '' }),
    execAsUser: jest.fn().mockResolvedValue({ success: true, stdout: '', stderr: '' }),
    onProgress: jest.fn(),
    onLog: jest.fn(),
    ...overrides,
  };
}

function createMockStep(overrides?: Partial<InstallStep>): InstallStep {
  return {
    id: 'test_step',
    name: 'Test Step',
    description: 'A test step',
    phase: 1,
    progressMessage: 'Running test step...',
    runsAs: 'root',
    timeout: 30000,
    weight: 1,
    run: jest.fn().mockResolvedValue({ changed: true }),
    ...overrides,
  };
}

describe('runPipeline', () => {
  it('executes steps in order', async () => {
    const executionOrder: string[] = [];
    const ctx = createMockContext();

    const steps: InstallStep[] = [
      createMockStep({
        id: 'step_1',
        name: 'Step 1',
        run: jest.fn().mockImplementation(async () => {
          executionOrder.push('step_1');
          return { changed: true };
        }),
      }),
      createMockStep({
        id: 'step_2',
        name: 'Step 2',
        run: jest.fn().mockImplementation(async () => {
          executionOrder.push('step_2');
          return { changed: true };
        }),
      }),
      createMockStep({
        id: 'step_3',
        name: 'Step 3',
        run: jest.fn().mockImplementation(async () => {
          executionOrder.push('step_3');
          return { changed: false };
        }),
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(true);
    expect(executionOrder).toEqual(['step_1', 'step_2', 'step_3']);
  });

  it('returns success=false on step failure', async () => {
    const ctx = createMockContext();

    const steps: InstallStep[] = [
      createMockStep({
        id: 'failing_step',
        name: 'Failing Step',
        run: jest.fn().mockRejectedValue(new Error('Something went wrong')),
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe('failing_step');
    expect(result.error).toContain('Something went wrong');
  });

  it('skips steps when skip predicate returns true', async () => {
    const ctx = createMockContext();
    const runFn = jest.fn().mockResolvedValue({ changed: true });

    const steps: InstallStep[] = [
      createMockStep({
        id: 'skipped_step',
        name: 'Skipped Step',
        skip: () => true,
        run: runFn,
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(true);
    expect(runFn).not.toHaveBeenCalled();
  });

  it('skips steps when check returns satisfied', async () => {
    const ctx = createMockContext();
    const runFn = jest.fn().mockResolvedValue({ changed: true });

    const steps: InstallStep[] = [
      createMockStep({
        id: 'checked_step',
        name: 'Already Satisfied Step',
        check: jest.fn().mockResolvedValue('satisfied'),
        run: runFn,
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(true);
    expect(runFn).not.toHaveBeenCalled();
  });

  it('runs step when check returns needed', async () => {
    const ctx = createMockContext();
    const runFn = jest.fn().mockResolvedValue({ changed: true });

    const steps: InstallStep[] = [
      createMockStep({
        id: 'needed_step',
        name: 'Needed Step',
        check: jest.fn().mockResolvedValue('needed'),
        run: runFn,
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(true);
    expect(runFn).toHaveBeenCalled();
  });

  it('reports progress via onProgress', async () => {
    const onProgress = jest.fn();
    const ctx = createMockContext({ onProgress });

    const steps: InstallStep[] = [
      createMockStep({ id: 'step_a', weight: 1 }),
      createMockStep({ id: 'step_b', weight: 1 }),
    ];

    await runPipeline(steps, ctx);

    // onProgress should be called for each step + the final 'complete'
    expect(onProgress).toHaveBeenCalled();
    const completeCalls = onProgress.mock.calls.filter(
      (call: unknown[]) => call[0] === 'complete',
    );
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0][1]).toBe(100);
  });

  it('merges step outputs into pipeline state', async () => {
    const ctx = createMockContext();
    const secondRunFn = jest.fn().mockImplementation(
      async (_ctx: InstallContext, state: PipelineState) => {
        // Check that first step's output is available
        expect(state.outputs['step_1.nodePath']).toBe('/usr/bin/node');
        return { changed: true };
      },
    );

    const steps: InstallStep[] = [
      createMockStep({
        id: 'step_1',
        run: jest.fn().mockResolvedValue({
          changed: true,
          outputs: { nodePath: '/usr/bin/node' },
        }),
      }),
      createMockStep({
        id: 'step_2',
        run: secondRunFn,
      }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.success).toBe(true);
    expect(secondRunFn).toHaveBeenCalled();
  });

  it('calls rollback on failure when rollbackOnFailure is true', async () => {
    const ctx = createMockContext();
    const rollbackFn = jest.fn();

    const steps: InstallStep[] = [
      createMockStep({
        id: 'step_1',
        run: jest.fn().mockResolvedValue({ changed: true }),
        rollback: rollbackFn,
      }),
      createMockStep({
        id: 'step_2',
        run: jest.fn().mockRejectedValue(new Error('fail')),
      }),
    ];

    await runPipeline(steps, ctx, { rollbackOnFailure: true });

    expect(rollbackFn).toHaveBeenCalled();
  });

  it('does not call rollback when rollbackOnFailure is false', async () => {
    const ctx = createMockContext();
    const rollbackFn = jest.fn();

    const steps: InstallStep[] = [
      createMockStep({
        id: 'step_1',
        run: jest.fn().mockResolvedValue({ changed: true }),
        rollback: rollbackFn,
      }),
      createMockStep({
        id: 'step_2',
        run: jest.fn().mockRejectedValue(new Error('fail')),
      }),
    ];

    await runPipeline(steps, ctx, { rollbackOnFailure: false });

    expect(rollbackFn).not.toHaveBeenCalled();
  });

  it('generates manifest entries for all steps', async () => {
    const ctx = createMockContext();

    const steps: InstallStep[] = [
      createMockStep({ id: 'step_1', phase: 1 }),
      createMockStep({ id: 'step_2', phase: 2 }),
    ];

    const result = await runPipeline(steps, ctx);

    expect(result.manifestEntries).toHaveLength(2);
    expect(result.manifestEntries[0].stepId).toBe('step_1');
    expect(result.manifestEntries[0].status).toBe('completed');
    expect(result.manifestEntries[1].stepId).toBe('step_2');
  });

  it('skips steps outside version range', async () => {
    const ctx = createMockContext();
    const runFn = jest.fn().mockResolvedValue({ changed: true });

    const steps: InstallStep[] = [
      createMockStep({
        id: 'versioned_step',
        versionRange: '>=2.0.0',
        run: runFn,
      }),
    ];

    const result = await runPipeline(steps, ctx, { version: '1.5.0' });

    expect(result.success).toBe(true);
    expect(runFn).not.toHaveBeenCalled();
    expect(result.manifestEntries[0].status).toBe('skipped');
  });

  it('runs steps within version range', async () => {
    const ctx = createMockContext();
    const runFn = jest.fn().mockResolvedValue({ changed: true });

    const steps: InstallStep[] = [
      createMockStep({
        id: 'versioned_step',
        versionRange: '>=1.0.0',
        run: runFn,
      }),
    ];

    const result = await runPipeline(steps, ctx, { version: '2.0.0' });

    expect(result.success).toBe(true);
    expect(runFn).toHaveBeenCalled();
  });

  it('calls onStepStart and onStepComplete callbacks', async () => {
    const ctx = createMockContext();
    const onStepStart = jest.fn();
    const onStepComplete = jest.fn();

    const steps: InstallStep[] = [
      createMockStep({ id: 'step_1' }),
    ];

    await runPipeline(steps, ctx, { onStepStart, onStepComplete });

    expect(onStepStart).toHaveBeenCalledTimes(1);
    expect(onStepComplete).toHaveBeenCalledTimes(1);
  });
});

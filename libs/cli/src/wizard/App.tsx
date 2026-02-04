/**
 * Main Wizard App component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, useApp } from 'ink';
import { Header } from './components/Header.js';
import { StepList } from './components/StepList.js';
import { ProgressBar } from './components/ProgressBar.js';
import { Summary } from './components/Summary.js';
import { Confirm } from './components/Confirm.js';
import { ModeSelect, type SetupMode } from './components/ModeSelect.js';
import { AdvancedConfig, computeNames, REQUIRED_PREFIX, type ComputedNames } from './components/AdvancedConfig.js';
import { PasscodeSetup } from './components/PasscodeSetup.js';
import { createWizardEngine } from './engine.js';
import { userExists, groupExists } from '@agenshield/sandbox';
import type { WizardState, WizardContext, WizardOptions } from './types.js';

type WizardPhase =
  | 'detecting'
  | 'mode_select'
  | 'advanced_config'
  | 'confirming'
  | 'running'
  | 'passcode_setup'
  | 'finalizing'
  | 'complete';

/**
 * Read wizard options from environment variables set by the CLI
 */
function getOptionsFromEnv(): WizardOptions {
  const options: WizardOptions = {};

  if (process.env['AGENSHIELD_TARGET']) {
    options.targetPreset = process.env['AGENSHIELD_TARGET'];
  }
  if (process.env['AGENSHIELD_ENTRY_POINT']) {
    options.entryPoint = process.env['AGENSHIELD_ENTRY_POINT'];
  }
  if (process.env['AGENSHIELD_BASE_NAME']) {
    options.baseName = process.env['AGENSHIELD_BASE_NAME'];
  }
  if (process.env['AGENSHIELD_PREFIX']) {
    options.prefix = process.env['AGENSHIELD_PREFIX'];
  }
  if (process.env['AGENSHIELD_BASE_UID']) {
    options.baseUid = parseInt(process.env['AGENSHIELD_BASE_UID'], 10);
  }
  if (process.env['AGENSHIELD_DRY_RUN'] === 'true') {
    options.dryRun = true;
  }
  if (process.env['AGENSHIELD_SKIP_CONFIRM'] === 'true') {
    options.skipConfirm = true;
  }
  if (process.env['AGENSHIELD_VERBOSE'] === 'true') {
    options.verbose = true;
  }

  return options;
}

/**
 * Check if any users or groups already exist
 */
async function checkConflicts(names: ComputedNames): Promise<{ users: string[]; groups: string[] }> {
  const existingUsers: string[] = [];
  const existingGroups: string[] = [];

  // Check users
  if (await userExists(names.agentUser)) {
    existingUsers.push(names.agentUser);
  }
  if (await userExists(names.brokerUser)) {
    existingUsers.push(names.brokerUser);
  }

  // Check groups
  if (await groupExists(names.socketGroup)) {
    existingGroups.push(names.socketGroup);
  }
  if (await groupExists(names.workspaceGroup)) {
    existingGroups.push(names.workspaceGroup);
  }

  return { users: existingUsers, groups: existingGroups };
}

export function WizardApp() {
  const { exit } = useApp();
  const [state, setState] = useState<WizardState | null>(null);
  const [context, setContext] = useState<WizardContext>({});
  const [phase, setPhase] = useState<WizardPhase>('detecting');
  const [engine, setEngine] = useState<ReturnType<typeof createWizardEngine> | null>(null);
  const [options, setOptions] = useState<WizardOptions>({});
  const [setupMode, setSetupMode] = useState<SetupMode>('quick');

  // Initialize wizard and run detection phase
  useEffect(() => {
    const envOptions = getOptionsFromEnv();
    setOptions(envOptions);

    const wizardEngine = createWizardEngine(envOptions);

    wizardEngine.onStateChange = (newState) => {
      setState({ ...newState });
      setContext({ ...wizardEngine.context });
    };

    // Initialize state
    setState({ ...wizardEngine.state });
    setEngine(wizardEngine);

    // Run detection phase only (steps: prerequisites, detect)
    wizardEngine.runDetectionPhase().then((result) => {
      if (result.success && wizardEngine.context.presetDetection?.found) {
        // If baseName was provided via CLI, skip mode selection
        if (envOptions.baseName) {
          setPhase('confirming');
        } else {
          setPhase('mode_select');
        }
      } else {
        // Detection failed or no target found
        setPhase('complete');
      }
    });
  }, []);

  // Handle mode selection
  const handleModeSelect = useCallback((mode: SetupMode) => {
    setSetupMode(mode);
    if (mode === 'quick') {
      // Use default naming (ash_ prefix with default suffix)
      setOptions(prev => ({ ...prev, baseName: 'default' }));
      if (engine) {
        engine.context.options = { ...engine.context.options, baseName: 'default' };
      }
      setPhase('confirming');
    } else {
      setPhase('advanced_config');
    }
  }, [engine]);

  // Handle advanced config confirmation
  const handleAdvancedConfig = useCallback((values: { agentSuffix: string }) => {
    // Set the baseName from the advanced config
    const baseName = values.agentSuffix;
    setOptions(prev => ({ ...prev, baseName }));
    if (engine) {
      engine.context.options = { ...engine.context.options, baseName };
    }
    setPhase('confirming');
  }, [engine]);

  // Handle user confirmation
  const handleConfirm = useCallback(() => {
    if (!engine) return;

    setPhase('running');

    // Run setup steps (confirm through verify, excludes passcode and complete)
    engine.runSetupPhase().then(() => {
      if (engine.state.hasError) {
        setPhase('complete');
      } else {
        // Show passcode setup UI
        setPhase('passcode_setup');
      }
    });
  }, [engine]);

  // Handle passcode set
  const handleSetPasscode = useCallback((passcode: string) => {
    if (!engine) return;

    // Store passcode in context for the executor
    engine.context.passcodeValue = passcode;
    setPhase('finalizing');

    // Run final steps (setup-passcode + complete)
    engine.runFinalPhase().then(() => {
      setPhase('complete');
    });
  }, [engine]);

  // Handle passcode skip
  const handleSkipPasscode = useCallback(() => {
    if (!engine) return;

    // Mark as skipped in context
    engine.context.passcodeSetup = { configured: false, skipped: true };
    setPhase('finalizing');

    // Run final steps (setup-passcode + complete)
    engine.runFinalPhase().then(() => {
      setPhase('complete');
    });
  }, [engine]);

  // Handle user cancellation
  const handleCancel = useCallback(() => {
    exit();
  }, [exit]);

  if (!state) {
    return null;
  }

  const completedSteps = state.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = state.steps.length;

  // Compute display names based on current options
  const displayNames = options.baseName
    ? computeNames(options.baseName)
    : computeNames('default');

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {/* Show progress bar and steps during detection, running, and finalizing phases */}
      {(phase === 'detecting' || phase === 'running' || phase === 'finalizing') && (
        <>
          <ProgressBar current={completedSteps} total={totalSteps} />
          <StepList steps={state.steps} currentStep={state.currentStep} />
        </>
      )}

      {/* Mode selection after detection */}
      {phase === 'mode_select' && (
        <ModeSelect
          onSelect={handleModeSelect}
          onCancel={handleCancel}
        />
      )}

      {/* Advanced configuration for custom naming */}
      {phase === 'advanced_config' && (
        <AdvancedConfig
          onConfirm={handleAdvancedConfig}
          onCancel={handleCancel}
          onCheckConflicts={checkConflicts}
        />
      )}

      {/* Show confirmation prompt after mode/config selection */}
      {phase === 'confirming' && context.presetDetection?.found && (
        <Confirm
          installation={{
            found: true,
            method: (context.presetDetection.method === 'npm' || context.presetDetection.method === 'git')
              ? context.presetDetection.method
              : 'unknown',
            packagePath: context.presetDetection.packagePath,
            binaryPath: context.presetDetection.binaryPath,
            configPath: context.presetDetection.configPath,
            version: context.presetDetection.version,
          }}
          presetName={context.preset?.name}
          userNames={displayNames}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* Passcode setup after install steps complete */}
      {phase === 'passcode_setup' && (
        <>
          <ProgressBar current={completedSteps} total={totalSteps} />
          <PasscodeSetup
            onSetPasscode={handleSetPasscode}
            onSkip={handleSkipPasscode}
          />
        </>
      )}

      {/* Show summary after completion */}
      {phase === 'complete' && (
        <>
          <ProgressBar current={completedSteps} total={totalSteps} />
          <StepList steps={state.steps} currentStep={state.currentStep} />
          <Summary success={state.isComplete && !state.hasError} context={context} />
        </>
      )}
    </Box>
  );
}

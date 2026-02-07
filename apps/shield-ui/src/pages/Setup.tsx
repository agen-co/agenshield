/**
 * Setup page — step state machine for the setup wizard
 *
 * Manages which wizard step is shown and transitions between them.
 * Wraps everything in SetupLayout (split-panel).
 *
 * Steps: 0 Detection, 1 Mode, 2 Config, 3 Confirm, 4 Infrastructure,
 *        5 Migration Select, 6 Migrating, 7 Passcode, 8 Complete
 */

import { useCallback, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import { setupStore, deriveGraphPhase, type GraphPhase } from '../state/setup';
import { useSetupSSE, useConfigure, useConfirmSetup, useSetPasscode, useSelectItems } from '../api/setup';
import {
  SetupLayout,
  DetectionStep,
  ModeSelectStep,
  AdvancedConfigStep,
  ConfirmStep,
  ExecutionStep,
  MigrationSelectStep,
  MigrationExecutionStep,
  PasscodeStep,
  CompleteStep,
} from '../components/setup';

export function SetupWizard() {
  // Connect to SSE for real-time updates
  useSetupSSE();

  const { currentUIStep, completedEngineSteps, phase } = useSnapshot(setupStore);

  const configure = useConfigure();
  const confirmSetup = useConfirmSetup();
  const setPasscode = useSetPasscode();
  const selectItems = useSelectItems();

  // Keep graphPhase in sync with completed steps (only advance forward, never regress)
  useEffect(() => {
    if (completedEngineSteps.length > 0) {
      const derived = deriveGraphPhase([...completedEngineSteps]);
      const phaseOrder: GraphPhase[] = ['vulnerable', 'building', 'securing', 'secured'];
      const currentIdx = phaseOrder.indexOf(setupStore.graphPhase);
      const derivedIdx = phaseOrder.indexOf(derived);
      if (derivedIdx > currentIdx) {
        setupStore.graphPhase = derived;
      }
    }
  }, [completedEngineSteps]);

  // Auto-advance based on phase changes
  useEffect(() => {
    // When infrastructure + scan completes, go to migration selection (step 5)
    if (phase === 'selection' && currentUIStep === 4) {
      setupStore.currentUIStep = 5;
    }
    // When migration phase completes (verify done), go to passcode (step 7)
    if (phase === 'migration' && currentUIStep === 5) {
      setupStore.currentUIStep = 6;
    }
    if (phase === 'passcode' && currentUIStep < 7) {
      if (completedEngineSteps.includes('verify')) {
        setupStore.currentUIStep = 7;
        setupStore.phase = 'passcode';
      }
    }
    if (phase === 'complete' && currentUIStep < 8) {
      setupStore.currentUIStep = 8;
    }
  }, [phase, completedEngineSteps, currentUIStep]);

  // --- Step handlers ---

  const goToStep = useCallback((step: number) => {
    setupStore.currentUIStep = step;
  }, []);

  const handleDetectionNext = useCallback(() => {
    goToStep(1);
  }, [goToStep]);

  const handleModeSelect = useCallback((mode: 'quick' | 'advanced') => {
    setupStore.mode = mode;
    if (mode === 'quick') {
      // Configure with defaults
      configure.mutate({ mode: 'quick' }, {
        onSuccess: () => {
          setupStore.baseName = 'default';
          setupStore.graphPhase = 'building';
          goToStep(3); // Skip advanced config, go to confirm
        },
      });
    } else {
      goToStep(2); // Advanced config
    }
  }, [configure, goToStep]);

  const handleAdvancedNext = useCallback((baseName: string) => {
    configure.mutate({ mode: 'advanced', baseName }, {
      onSuccess: () => {
        setupStore.graphPhase = 'building';
        goToStep(3); // Confirm
      },
    });
  }, [configure, goToStep]);

  const handleConfirm = useCallback(() => {
    goToStep(4); // Infrastructure execution
    setupStore.phase = 'execution';
    setupStore.graphPhase = 'securing';
    confirmSetup.mutate();
  }, [confirmSetup, goToStep]);

  const handleMigrationSelect = useCallback((selectedSkills: string[], selectedEnvVars: string[]) => {
    goToStep(6); // Migration execution
    setupStore.phase = 'migration';
    selectItems.mutate({ selectedSkills, selectedEnvVars });
  }, [selectItems, goToStep]);

  const handlePasscodeSet = useCallback((passcode: string) => {
    setPasscode.mutate({ passcode });
  }, [setPasscode]);

  const handlePasscodeSkip = useCallback(() => {
    setPasscode.mutate({ skip: true });
  }, [setPasscode]);

  // --- Render current step ---

  const renderStep = () => {
    switch (currentUIStep) {
      case 0:
        return <DetectionStep onNext={handleDetectionNext} />;
      case 1:
        return <ModeSelectStep onSelect={handleModeSelect} />;
      case 2:
        return <AdvancedConfigStep onNext={handleAdvancedNext} onBack={() => goToStep(1)} />;
      case 3:
        return <ConfirmStep onConfirm={handleConfirm} onBack={() => goToStep(setupStore.mode === 'quick' ? 1 : 2)} />;
      case 4:
        return <ExecutionStep />;
      case 5:
        return <MigrationSelectStep onConfirm={handleMigrationSelect} />;
      case 6:
        return <MigrationExecutionStep />;
      case 7:
        return <PasscodeStep onSet={handlePasscodeSet} onSkip={handlePasscodeSkip} />;
      case 8:
        return <CompleteStep />;
      default:
        return <DetectionStep onNext={handleDetectionNext} />;
    }
  };

  // Complete step renders full-screen (no wizard chrome)
  if (currentUIStep === 8) {
    return <CompleteStep />;
  }

  return (
    <SetupLayout>
      {renderStep()}
    </SetupLayout>
  );
}

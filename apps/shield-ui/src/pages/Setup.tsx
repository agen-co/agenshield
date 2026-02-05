/**
 * Setup page — step state machine for the setup wizard
 *
 * Manages which wizard step is shown and transitions between them.
 * Wraps everything in SetupLayout (split-panel).
 */

import { useCallback, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import { setupStore, deriveGraphPhase, type GraphPhase } from '../state/setup';
import { useSetupSSE, useConfigure, useConfirmSetup, useSetPasscode } from '../api/setup';
import {
  SetupLayout,
  DetectionStep,
  ModeSelectStep,
  AdvancedConfigStep,
  ConfirmStep,
  ExecutionStep,
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

  // Auto-advance to passcode step when execution completes
  useEffect(() => {
    if (phase === 'execution' && currentUIStep === 4) {
      // Check if verify step is completed
      if (completedEngineSteps.includes('verify')) {
        setupStore.currentUIStep = 5;
        setupStore.phase = 'passcode';
      }
    }
    if (phase === 'complete' && currentUIStep < 6) {
      setupStore.currentUIStep = 6;
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
    goToStep(4); // Execution
    setupStore.phase = 'execution';
    setupStore.graphPhase = 'securing';
    confirmSetup.mutate();
  }, [confirmSetup, goToStep]);

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
        return <PasscodeStep onSet={handlePasscodeSet} onSkip={handlePasscodeSkip} />;
      case 6:
        return <CompleteStep />;
      default:
        return <DetectionStep onNext={handleDetectionNext} />;
    }
  };

  return (
    <SetupLayout>
      {renderStep()}
    </SetupLayout>
  );
}

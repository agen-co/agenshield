/**
 * Uninstall Wizard App component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { UninstallConfirm } from './components/Confirm.js';
import { Header } from './components/Header.js';
import type { InstallationBackup } from '@agenshield/ipc';
import {
  canUninstall,
  restoreInstallation,
  type RestoreProgress,
  type RestoreStep,
} from '@agenshield/sandbox';

type UninstallPhase = 'checking' | 'confirming' | 'running' | 'complete' | 'error';

interface UninstallStep {
  id: RestoreStep;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  message?: string;
  error?: string;
}

const STEP_NAMES: Record<RestoreStep, string> = {
  validate: 'Validate',
  'stop-daemon': 'Stop Daemon',
  'restore-config': 'Restore Config',
  'restore-package': 'Restore Package',
  'delete-user': 'Delete Sandbox User',
  'remove-shell': 'Remove Guarded Shell',
  cleanup: 'Cleanup',
  verify: 'Verify',
};

function createUninstallSteps(): UninstallStep[] {
  return [
    { id: 'stop-daemon', name: 'Stop Daemon', status: 'pending' },
    { id: 'restore-config', name: 'Restore Config', status: 'pending' },
    { id: 'restore-package', name: 'Restore Package', status: 'pending' },
    { id: 'delete-user', name: 'Delete Sandbox User', status: 'pending' },
    { id: 'remove-shell', name: 'Remove Guarded Shell', status: 'pending' },
    { id: 'cleanup', name: 'Cleanup', status: 'pending' },
    { id: 'verify', name: 'Verify', status: 'pending' },
  ];
}

function StepStatus({ step }: { step: UninstallStep }) {
  let icon: string;
  let color: string;

  switch (step.status) {
    case 'completed':
      icon = '\u2713';
      color = 'green';
      break;
    case 'running':
      icon = '\u25cf';
      color = 'yellow';
      break;
    case 'error':
      icon = '\u2717';
      color = 'red';
      break;
    case 'skipped':
      icon = '\u2014';
      color = 'gray';
      break;
    default:
      icon = '\u25cb';
      color = 'gray';
  }

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text color={step.status === 'running' ? 'yellow' : undefined}>
        {step.name}
      </Text>
      {step.message && <Text color="gray"> - {step.message}</Text>}
      {step.error && <Text color="red"> - {step.error}</Text>}
    </Box>
  );
}

interface UninstallAppProps {
  backup: InstallationBackup;
}

export function UninstallApp({ backup }: UninstallAppProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<UninstallPhase>('confirming');
  const [steps, setSteps] = useState<UninstallStep[]>(createUninstallSteps());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleProgress = useCallback((progress: RestoreProgress) => {
    setSteps((prev) =>
      prev.map((step) => {
        if (step.id === progress.step) {
          return {
            ...step,
            status: progress.success ? 'completed' : 'error',
            message: progress.success ? progress.message : undefined,
            error: progress.error,
          };
        }
        return step;
      })
    );
  }, []);

  const handleConfirm = useCallback(() => {
    setPhase('running');

    // Run the uninstall process
    const result = restoreInstallation(backup, handleProgress);

    if (result.success) {
      setSuccess(true);
      setPhase('complete');
    } else {
      setErrorMessage(result.error || 'Unknown error');
      setPhase('error');
    }
  }, [backup, handleProgress]);

  const handleCancel = useCallback(() => {
    exit();
  }, [exit]);

  // Mark current step as running
  useEffect(() => {
    if (phase === 'running') {
      // Find the first pending step and mark it as running
      setSteps((prev) => {
        const firstPending = prev.findIndex((s) => s.status === 'pending');
        if (firstPending >= 0) {
          return prev.map((step, i) =>
            i === firstPending ? { ...step, status: 'running' } : step
          );
        }
        return prev;
      });
    }
  }, [phase]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="red">
          AgenShield Uninstall
        </Text>
      </Box>

      {/* Confirmation phase */}
      {phase === 'confirming' && (
        <UninstallConfirm
          backupTimestamp={backup.timestamp}
          sandboxUsername={backup.sandboxUser.username}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* Running or complete phase */}
      {(phase === 'running' || phase === 'complete' || phase === 'error') && (
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            {steps.map((step) => (
              <StepStatus key={step.id} step={step} />
            ))}
          </Box>

          {phase === 'complete' && success && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="green" bold>
                Uninstall complete!
              </Text>
              <Text color="gray">
                OpenClaw has been restored to its original location.
              </Text>
              <Text color="gray">
                Run 'openclaw --version' to verify.
              </Text>
            </Box>
          )}

          {phase === 'error' && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red" bold>
                Uninstall failed!
              </Text>
              {errorMessage && <Text color="red">{errorMessage}</Text>}
              <Text color="gray">
                Please check the errors above and try again.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Pre-check component shown before the main uninstall UI
 * Handles root check and backup validation
 */
export function UninstallPreCheck() {
  const { exit } = useApp();
  const [checkResult, setCheckResult] = useState<ReturnType<typeof canUninstall> | null>(null);

  useEffect(() => {
    const result = canUninstall();
    setCheckResult(result);
  }, []);

  if (!checkResult) {
    return (
      <Box padding={1}>
        <Text>Checking uninstall requirements...</Text>
      </Box>
    );
  }

  if (!checkResult.isRoot) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Uninstall requires root privileges.
        </Text>
        <Text> </Text>
        <Text>Run: <Text color="cyan">sudo agenshield uninstall</Text></Text>
      </Box>
    );
  }

  if (!checkResult.hasBackup || !checkResult.backup) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          No backup found.
        </Text>
        <Text> </Text>
        <Text color="gray">
          Cannot safely uninstall without a backup.
        </Text>
        <Text color="gray">
          The backup is created during 'agenshield setup'.
        </Text>
      </Box>
    );
  }

  // All checks passed - show main uninstall UI
  return <UninstallApp backup={checkResult.backup} />;
}

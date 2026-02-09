/**
 * Update Wizard — step state machine for the update flow
 *
 * Manages which step is shown and transitions between them.
 * Steps: Release Notes -> Authenticate (if needed) -> Confirm -> Execution -> Complete
 */

import { useCallback, useEffect } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useSnapshot } from 'valtio';
import { Shield, ArrowRight } from 'lucide-react';
import { styled, useTheme } from '@mui/material/styles';
import { updateStore, type UpdatePhase } from '../../state/update';
import { useUpdateSSE, useUpdateState, useConfirmUpdate } from '../../api/update';
import { ReleaseNotesStep } from './ReleaseNotesStep';
import { AuthenticateStep } from './AuthenticateStep';
import { ExecutionStep } from './ExecutionStep';
import { CompleteStep } from './CompleteStep';

// --- Layout ---

const FullScreen = styled('div')({
  display: 'flex',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
});

const LeftPanel = styled('div')(({ theme }) => ({
  width: '50%',
  minWidth: 380,
  maxWidth: 720,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${theme.palette.divider}`,
  overflow: 'hidden',
}));

const RightPanel = styled('div')(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(4),
  background: theme.palette.mode === 'dark' ? '#0a0a0f' : theme.palette.grey[50],
}));

// --- Confirm step (inline) ---

function ConfirmStep({ onConfirm }: { onConfirm: () => void }) {
  const { updateState } = useSnapshot(updateStore);
  const steps = updateState?.steps ?? [];
  const migrationSteps = steps.filter(s => s.isMigration);
  const builtinSteps = steps.filter(s => !s.isMigration);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Confirm Update
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        The following operations will be performed. All existing users, groups, and data will be preserved.
      </Typography>

      {migrationSteps.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Migrations ({migrationSteps.length} step{migrationSteps.length !== 1 ? 's' : ''})
          </Typography>
          {migrationSteps.map((step) => (
            <Typography key={step.id} variant="body2" color="text.secondary" sx={{ pl: 2, mb: 0.25 }}>
              &bull; {step.name}
            </Typography>
          ))}
        </Box>
      )}

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          System updates ({builtinSteps.length} step{builtinSteps.length !== 1 ? 's' : ''})
        </Typography>
        {builtinSteps.map((step) => (
          <Typography key={step.id} variant="body2" color="text.secondary" sx={{ pl: 2, mb: 0.25 }}>
            &bull; {step.name}
          </Typography>
        ))}
      </Box>

      <Button
        variant="contained"
        size="large"
        onClick={onConfirm}
        endIcon={<ArrowRight size={18} />}
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        Start Update
      </Button>
    </Box>
  );
}

// --- Phase indicator ---

const PHASES: Array<{ key: UpdatePhase; label: string }> = [
  { key: 'release-notes', label: 'Release Notes' },
  { key: 'authenticate', label: 'Authenticate' },
  { key: 'confirm', label: 'Confirm' },
  { key: 'execution', label: 'Update' },
  { key: 'complete', label: 'Complete' },
];

function PhaseIndicator({ currentPhase }: { currentPhase: UpdatePhase }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const currentIdx = PHASES.findIndex(p => p.key === currentPhase);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, mb: 3, px: 0.5 }}>
      {PHASES.map((phase, i) => {
        const isCompleted = i < currentIdx;
        const isActive = i === currentIdx;

        return (
          <Box key={phase.key} sx={{ display: 'flex', alignItems: 'center', flex: i < PHASES.length - 1 ? 1 : undefined }}>
            <Box
              sx={{
                width: isActive ? 28 : 22,
                height: isActive ? 28 : 22,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "'Manrope', sans-serif",
                transition: 'all 0.2s ease',
                ...(isCompleted && {
                  bgcolor: isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                  border: '2px solid',
                  borderColor: 'success.main',
                  color: 'success.main',
                }),
                ...(isActive && {
                  bgcolor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
                  border: '2px solid',
                  borderColor: 'text.primary',
                  color: 'text.primary',
                }),
                ...(!isCompleted && !isActive && {
                  bgcolor: 'transparent',
                  border: '2px solid',
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
                  color: 'text.disabled',
                }),
              }}
              title={phase.label}
            >
              {i + 1}
            </Box>

            {i < PHASES.length - 1 && (
              <Box
                sx={{
                  flex: 1,
                  height: 2,
                  mx: 0.5,
                  borderRadius: 1,
                  transition: 'background 0.2s ease',
                  bgcolor: i < currentIdx
                    ? 'success.main'
                    : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// --- Main Component ---

export function UpdateWizard() {
  useUpdateSSE();

  const { phase, updateState } = useSnapshot(updateStore);
  const { data } = useUpdateState();
  const confirmUpdate = useConfirmUpdate();

  // Hydrate store from initial API call
  useEffect(() => {
    if (data?.data?.state && !updateState) {
      updateStore.updateState = data.data.state;

      // Auto-skip authenticate step if no auth required
      if (!data.data.authRequired && phase === 'release-notes') {
        // Will be skipped when user clicks Continue
      }
    }
  }, [data, updateState, phase]);

  // Auto-advance to complete when done
  useEffect(() => {
    if (updateState?.isComplete && phase === 'execution') {
      updateStore.phase = 'complete';
    }
    if (updateState?.hasError && phase === 'execution') {
      updateStore.phase = 'complete';
    }
  }, [updateState, phase]);

  const handleReleaseNotesNext = useCallback(() => {
    if (updateState?.authRequired && !updateState?.authenticated) {
      updateStore.phase = 'authenticate';
    } else {
      updateStore.phase = 'confirm';
    }
  }, [updateState]);

  const handleAuthNext = useCallback(() => {
    updateStore.phase = 'confirm';
  }, []);

  const handleConfirm = useCallback(() => {
    updateStore.phase = 'execution';
    confirmUpdate.mutate();
  }, [confirmUpdate]);

  // Complete step renders full-screen
  if (phase === 'complete' || phase === 'error') {
    return <CompleteStep />;
  }

  return (
    <FullScreen>
      <LeftPanel>
        <Box sx={{ flex: '0 0 auto', p: '24px 24px 0' }}>
          {/* Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
            <Box
              sx={{
                width: 32, height: 32, borderRadius: 1.5,
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Shield size={18} color="white" />
            </Box>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: -0.3,
              }}
            >
              AgenShield Update
            </Typography>
          </Box>

          <PhaseIndicator currentPhase={phase} />
        </Box>

        <Box sx={{ flex: '1 1 0%', overflowY: 'auto', p: '0 24px 8px' }}>
          {phase === 'release-notes' && <ReleaseNotesStep onNext={handleReleaseNotesNext} />}
          {phase === 'authenticate' && <AuthenticateStep onNext={handleAuthNext} />}
          {phase === 'confirm' && <ConfirmStep onConfirm={handleConfirm} />}
          {phase === 'execution' && <ExecutionStep />}
        </Box>
      </LeftPanel>

      <RightPanel>
        {/* Version info display */}
        <Box sx={{ textAlign: 'center', maxWidth: 320 }}>
          <Box
            sx={{
              width: 80, height: 80, borderRadius: 3,
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 3,
            }}
          >
            <Shield size={40} color="white" />
          </Box>

          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            Non-destructive Update
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            All users, groups, configurations, and data will be preserved.
            Only binaries, wrappers, and security profiles will be updated.
          </Typography>

          {updateState && (
            <Box sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">
                Version
              </Typography>
              <Typography variant="h5" fontWeight={700} fontFamily="'IBM Plex Mono', monospace">
                {updateState.fromVersion} &rarr; {updateState.toVersion}
              </Typography>
            </Box>
          )}
        </Box>
      </RightPanel>
    </FullScreen>
  );
}

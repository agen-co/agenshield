/**
 * Full-screen split-panel layout for the setup wizard
 *
 * Left panel (40%): Step wizard with navigation
 * Right panel (60%): Security graph (top 2/3) + executables panel (bottom 1/3)
 */

import type { ReactNode } from 'react';
import { Box, Typography, Stepper, Step, StepLabel } from '@mui/material';
import { useSnapshot } from 'valtio';
import { styled } from '@mui/material/styles';
import { Shield } from 'lucide-react';
import { setupStore, UI_STEPS } from '../../state/setup';
import { SecurityGraph } from './graph/SecurityGraph';
import { ExecutablesPanel } from './graph/ExecutablesPanel';

// --- Styled components ---

const FullScreen = styled('div')({
  display: 'flex',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
});

const LeftPanel = styled('div')(({ theme }) => ({
  width: '40%',
  minWidth: 380,
  maxWidth: 560,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${theme.palette.divider}`,
  padding: theme.spacing(4, 3.5),
  overflowY: 'auto',
}));

const RightPanel = styled('div')(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: theme.spacing(2),
  gap: theme.spacing(1.5),
  background: theme.palette.mode === 'dark' ? '#0a0a0f' : theme.palette.grey[50],
}));

const GraphSection = styled('div')({
  flex: 2,
  minHeight: 0,
});

const ExecSection = styled('div')({
  flex: 1,
  minHeight: 200,
});

// --- Component ---

interface SetupLayoutProps {
  children: ReactNode;
}

export function SetupLayout({ children }: SetupLayoutProps) {
  const { currentUIStep } = useSnapshot(setupStore);

  return (
    <FullScreen>
      <LeftPanel>
        {/* Logo */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2,
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Shield size={20} color="white" />
          </Box>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: -0.5,
            }}
          >
            AgenShield
          </Typography>
        </Box>

        {/* Step content */}
        <Box sx={{ flex: 1 }}>
          {children}
        </Box>

        {/* Step indicators */}
        <Stepper
          activeStep={currentUIStep}
          orientation="vertical"
          sx={{ mt: 3 }}
        >
          {UI_STEPS.map((step) => (
            <Step key={step.key}>
              <StepLabel>
                <Typography variant="body2">{step.label}</Typography>
              </StepLabel>
            </Step>
          ))}
        </Stepper>
      </LeftPanel>

      <RightPanel>
        <GraphSection>
          <SecurityGraph />
        </GraphSection>
        <ExecSection>
          <ExecutablesPanel />
        </ExecSection>
      </RightPanel>
    </FullScreen>
  );
}

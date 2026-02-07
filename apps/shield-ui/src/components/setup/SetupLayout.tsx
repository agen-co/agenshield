/**
 * Full-screen split-panel layout for the setup wizard
 *
 * Left panel (1/3): Branding → step bar → step content
 * Right panel (2/3): Security graph (full height)
 */

import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useSnapshot } from 'valtio';
import { styled, useTheme } from '@mui/material/styles';
import { Shield, Check } from 'lucide-react';
import { setupStore, UI_STEPS } from '../../state/setup';
import { SecurityGraph } from './graph/SecurityGraph';

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
  padding: 0,
  background: theme.palette.mode === 'dark' ? '#0a0a0f' : theme.palette.grey[50],
}));

// --- Step indicator ---

function StepIndicator({ currentStep }: { currentStep: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, mb: 3, px: 0.5 }}>
      {UI_STEPS.map((step, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;

        return (
          <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', flex: i < UI_STEPS.length - 1 ? 1 : undefined }}>
            {/* Dot */}
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
              title={step.label}
            >
              {isCompleted ? <Check size={12} strokeWidth={3} /> : i + 1}
            </Box>

            {/* Connector line */}
            {i < UI_STEPS.length - 1 && (
              <Box
                sx={{
                  flex: 1,
                  height: 2,
                  mx: 0.5,
                  borderRadius: 1,
                  transition: 'background 0.2s ease',
                  bgcolor: i < currentStep
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

// --- Component ---

interface SetupLayoutProps {
  children: ReactNode;
}

export function SetupLayout({ children }: SetupLayoutProps) {
  const { currentUIStep } = useSnapshot(setupStore);

  return (
    <FullScreen>
      <LeftPanel>
        {/* Fixed header: branding + steps */}
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
              AgenShield Setup
            </Typography>
          </Box>

          {/* Horizontal step indicator */}
          <StepIndicator currentStep={currentUIStep} />
        </Box>

        {/* Scrollable content area */}
        <Box sx={{ flex: '1 1 0%', overflowY: 'auto', p: '0 24px 8px' }}>
          {children}
        </Box>
      </LeftPanel>

      <RightPanel>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <SecurityGraph />
        </Box>
      </RightPanel>
    </FullScreen>
  );
}

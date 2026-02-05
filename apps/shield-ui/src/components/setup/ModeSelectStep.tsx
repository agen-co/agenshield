/**
 * Step 1: Mode selection — Quick vs Advanced
 */

import { Box, Typography, Card, CardContent, CardActionArea } from '@mui/material';
import { Zap, Settings } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';

interface ModeSelectStepProps {
  onSelect: (mode: 'quick' | 'advanced') => void;
}

export function ModeSelectStep({ onSelect }: ModeSelectStepProps) {
  const handleSelect = (mode: 'quick' | 'advanced') => {
    setupStore.mode = mode;
    onSelect(mode);
  };

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Setup Mode
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Choose how you want to configure AgenShield's security sandbox.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Card
          sx={{
            border: '2px solid transparent',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: 'success.main' },
          }}
        >
          <CardActionArea onClick={() => handleSelect('quick')}>
            <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <Box
                sx={{
                  width: 44, height: 44, borderRadius: 2, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  bgcolor: 'rgba(34, 197, 94, 0.12)', flexShrink: 0,
                }}
              >
                <Zap size={22} color="#22c55e" />
              </Box>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>Quick Setup</Typography>
                <Typography variant="body2" color="text.secondary">
                  Use default user and group names. Recommended for most setups — you can customize later.
                </Typography>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>

        <Card
          sx={{
            border: '2px solid transparent',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: 'secondary.main' },
          }}
        >
          <CardActionArea onClick={() => handleSelect('advanced')}>
            <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <Box
                sx={{
                  width: 44, height: 44, borderRadius: 2, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  bgcolor: 'rgba(168, 85, 247, 0.12)', flexShrink: 0,
                }}
              >
                <Settings size={22} color="#a855f7" />
              </Box>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>Advanced Setup</Typography>
                <Typography variant="body2" color="text.secondary">
                  Customize user names, group names, and workspace paths. Useful for multi-tenant or enterprise deployments.
                </Typography>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>
    </Box>
  );
}

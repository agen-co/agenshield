import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { SearchX } from 'lucide-react';
import { PrimaryButton } from '../elements';
import { useServerMode } from '../api/hooks';
import { tokens } from '../styles/tokens';

export function NotFound() {
  const navigate = useNavigate();
  const serverMode = useServerMode();

  return (
    <Box
      sx={{
        maxWidth: tokens.page.maxWidth,
        mx: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 12,
        gap: 2,
      }}
    >
      <SearchX size={48} style={{ opacity: 0.5 }} />
      <Typography variant="h5" fontWeight={700}>
        Page not found
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The page you're looking for doesn't exist or has been moved.
      </Typography>
      <PrimaryButton onClick={() => navigate('/')}>
        {serverMode === 'setup' ? 'Go to Setup' : 'Go to Home'}
      </PrimaryButton>
    </Box>
  );
}

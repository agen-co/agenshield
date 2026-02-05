/**
 * Auth delegation banner - shown when agent needs authentication
 */

import { useState, useEffect, useCallback } from 'react';
import { Alert, Button, Collapse } from '@mui/material';
import { Link2 } from 'lucide-react';
import { useAgenCoOAuth } from './useAgenCoOAuth';

interface AgenCoAuthBannerProps {
  /** SSE event data when auth_required is received */
  authRequired: { authUrl?: string; integration?: string } | null;
  /** Called when auth is completed */
  onAuthCompleted: () => void;
}

export function AgenCoAuthBanner({ authRequired, onAuthCompleted }: AgenCoAuthBannerProps) {
  const [visible, setVisible] = useState(false);
  const { startAuth, loading } = useAgenCoOAuth();

  useEffect(() => {
    if (authRequired) {
      setVisible(true);
    }
  }, [authRequired]);

  const handleConnect = useCallback(async () => {
    await startAuth();
  }, [startAuth]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onAuthCompleted();
  }, [onAuthCompleted]);

  // Auto-dismiss when auth completes
  useEffect(() => {
    if (!authRequired && visible) {
      setVisible(false);
    }
  }, [authRequired, visible]);

  return (
    <Collapse in={visible}>
      <Alert
        severity="info"
        variant="outlined"
        sx={{ mt: 2 }}
        onClose={handleDismiss}
        action={
          <Button
            color="primary"
            size="small"
            variant="contained"
            startIcon={<Link2 size={14} />}
            onClick={handleConnect}
            disabled={loading}
          >
            {loading ? 'Connecting...' : 'Connect Now'}
          </Button>
        }
      >
        Your agent needs AgenCo authentication
        {authRequired?.integration ? ` for ${authRequired.integration}` : ''}.
      </Alert>
    </Collapse>
  );
}

/**
 * Lock banner component
 *
 * Shows a banner at the top of the page when passcode protection is enabled
 * but the user is not authenticated.
 */

import { useState } from 'react';
import { Alert, Button, Box } from '@mui/material';
import { Lock as LockIcon, LockOpen as LockOpenIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PasscodeDialog } from './PasscodeDialog';

export function LockBanner() {
  const { protectionEnabled, authenticated, passcodeSet, lock } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Don't show anything if protection isn't enabled
  if (!protectionEnabled || !passcodeSet) {
    return null;
  }

  // Show authenticated state
  if (authenticated) {
    return (
      <Box sx={{ mb: 2 }}>
        <Alert
          severity="success"
          icon={<LockOpenIcon size={20} />}
          action={
            <Button color="inherit" size="small" onClick={() => lock()}>
              Lock
            </Button>
          }
        >
          Session active. Configuration changes are allowed.
        </Alert>
      </Box>
    );
  }

  // Show locked / read-only state
  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="info"
        icon={<LockIcon size={20} />}
        action={
          <Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>
            Unlock
          </Button>
        }
      >
        Read-only mode. Unlock with your passcode to make changes.
      </Alert>

      <PasscodeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}

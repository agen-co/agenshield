/**
 * Lock banner component
 *
 * Shows a banner at the top of the page when passcode protection is enabled
 * but the user is not authenticated.
 */

import React, { useState } from 'react';
import { Alert, AlertTitle, Button, Box } from '@mui/material';
import { Lock as LockIcon, LockOpen as LockOpenIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PasscodeDialog } from './PasscodeDialog';

export function LockBanner() {
  const { protectionEnabled, authenticated, passcodeSet, requiresAuth, lock } = useAuth();
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

  // Show locked state
  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="warning"
        icon={<LockIcon size={20} />}
        action={
          <Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>
            Unlock
          </Button>
        }
      >
        <AlertTitle>Protected Mode</AlertTitle>
        Configuration changes require authentication. Click Unlock to enter your passcode.
      </Alert>

      <PasscodeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}

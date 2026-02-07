/**
 * Global unlock-with-callback context.
 *
 * Provides a single UnlockDialog instance for the whole app.
 * Components call `requestUnlock()` to prompt the user for their passcode
 * before executing a protected action.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { UnlockDialog } from '../components/UnlockDialog';

interface UnlockRequest {
  description: string;
  actionLabel: string;
  onUnlocked: () => void;
}

interface UnlockContextValue {
  requestUnlock: (req: UnlockRequest) => void;
}

const UnlockContext = createContext<UnlockContextValue | undefined>(undefined);

export function UnlockProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [actionLabel, setActionLabel] = useState('Unlock');
  const onUnlockedRef = useRef<(() => void) | null>(null);

  const requestUnlock = useCallback((req: UnlockRequest) => {
    onUnlockedRef.current = req.onUnlocked;
    setDescription(req.description);
    setActionLabel(req.actionLabel);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    onUnlockedRef.current = null;
    setOpen(false);
  }, []);

  const handleSuccess = useCallback(() => {
    const cb = onUnlockedRef.current;
    onUnlockedRef.current = null;
    setOpen(false);
    cb?.();
  }, []);

  return (
    <UnlockContext.Provider value={{ requestUnlock }}>
      {children}
      <UnlockDialog
        open={open}
        description={description}
        actionLabel={actionLabel}
        onSuccess={handleSuccess}
        onClose={handleClose}
      />
    </UnlockContext.Provider>
  );
}

export function useUnlockAction(): UnlockContextValue {
  const context = useContext(UnlockContext);
  if (!context) {
    throw new Error('useUnlockAction must be used within an UnlockProvider');
  }
  return context;
}

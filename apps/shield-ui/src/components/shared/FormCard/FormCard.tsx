import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Card, Typography } from '@mui/material';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';

export interface FormCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  error?: string;
  onFocusChange?: (focused: boolean) => void;
}

export function FormCard({
  title,
  description,
  children,
  onSave,
  onCancel,
  saving,
  saveDisabled,
  saveLabel = 'Save',
  error,
  onFocusChange,
}: FormCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Auto-focus the first input after the entrance animation
  useEffect(() => {
    const timer = setTimeout(() => {
      const input = cardRef.current?.querySelector<HTMLElement>('input, textarea, select');
      input?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  const handleFocusIn = useCallback(() => {
    if (!focused) {
      setFocused(true);
      onFocusChange?.(true);
    }
  }, [focused, onFocusChange]);

  const handleFocusOut = useCallback(
    (e: React.FocusEvent) => {
      // Only blur if focus leaves the card entirely
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setFocused(false);
        onFocusChange?.(false);
      }
    },
    [onFocusChange],
  );

  return (
    <Card
      ref={cardRef}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
      sx={{
        '@keyframes cardFadeIn': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        animation: 'cardFadeIn 0.2s ease 250ms both',
        position: 'relative',
        zIndex: focused ? 10 : 'auto',
      }}
    >
      <Typography variant="h6" fontWeight={600}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}
      <Box sx={{ mt: 3 }}>{children}</Box>
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 2, display: 'block' }}>
          {error}
        </Typography>
      )}

      {/* Footer — edge-to-edge, matching SettingsCard pattern */}
      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${theme.palette.divider}`,
          mx: -3,
          mb: -3,
          mt: 3,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 1.5,
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 2,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 2,
          bgcolor:
            theme.palette.mode === 'dark'
              ? theme.palette.background.default
              : theme.palette.grey[50],
        })}
      >
        <SecondaryButton size="small" onClick={onCancel} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          size="small"
          onClick={onSave}
          loading={saving}
          disabled={saveDisabled || saving}
        >
          {saveLabel}
        </PrimaryButton>
      </Box>
    </Card>
  );
}

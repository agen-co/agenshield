import React from 'react';
import { Box, Card, Typography } from '@mui/material';
import { Check } from 'lucide-react';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import DangerButton from '../../../elements/buttons/DangerButton';

export interface SettingsCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footerInfo?: React.ReactNode;
  onSave: () => void;
  saving?: boolean;
  saved?: boolean;
  hasChanges?: boolean;
  disabled?: boolean;
  error?: string;
  danger?: boolean;
  saveLabel?: string;
}

export function SettingsCard({
  title,
  description,
  children,
  footerInfo,
  onSave,
  saving,
  saved,
  hasChanges,
  disabled,
  error,
  danger,
  saveLabel = 'Save',
}: SettingsCardProps) {
  const SaveButton = danger ? DangerButton : PrimaryButton;

  return (
    <Card
      sx={(theme) => ({
        ...(danger && {
          borderColor: theme.palette.error.main,
        }),
      })}
    >
      {/* Body — Card theme already provides p:3, so content sits at that level */}
      <Typography variant="h6" fontWeight={600}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}
      {children && <Box sx={{ mt: 3 }}>{children}</Box>}
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 2, display: 'block' }}>
          {error}
        </Typography>
      )}

      {/* Footer — breaks out of card padding to go edge-to-edge */}
      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${danger ? theme.palette.error.main : theme.palette.divider}`,
          mx: -3,
          mb: -3,
          mt: 3,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 2,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 2,
          bgcolor: danger
            ? theme.palette.mode === 'dark'
              ? 'rgba(225,88,62,0.06)'
              : 'rgba(225,88,62,0.04)'
            : theme.palette.mode === 'dark'
              ? theme.palette.background.default
              : theme.palette.grey[50],
        })}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {footerInfo && (
            <Typography variant="caption" color={danger ? 'error' : 'text.secondary'}>
              {footerInfo}
            </Typography>
          )}
        </Box>
        <SaveButton
          size="small"
          onClick={onSave}
          loading={saving}
          disabled={!hasChanges || saving || disabled}
          startIcon={saved ? <Check size={14} /> : undefined}
          sx={{ flexShrink: 0 }}
        >
          {saved ? 'Saved' : saveLabel}
        </SaveButton>
      </Box>
    </Card>
  );
}

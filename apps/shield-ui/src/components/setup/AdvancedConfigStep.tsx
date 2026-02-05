/**
 * Step 2: Advanced configuration — baseName input with live conflict checking
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Card, CardContent, TextField, Alert,
  InputAdornment, CircularProgress,
} from '@mui/material';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { useCheckConflicts } from '../../api/setup';
import { slideIn } from '../../styles/animations';

interface AdvancedConfigStepProps {
  onNext: (baseName: string) => void;
  onBack: () => void;
}

export function AdvancedConfigStep({ onNext, onBack }: AdvancedConfigStepProps) {
  const [baseName, setBaseName] = useState(setupStore.baseName || '');
  const [conflicts, setConflicts] = useState<{ users: string[]; groups: string[] } | null>(null);
  const checkConflicts = useCheckConflicts();

  const cleanName = baseName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const preview = cleanName
    ? {
        agentUser: `ash_${cleanName}_agent`,
        brokerUser: `ash_${cleanName}_broker`,
        socketGroup: `ash_${cleanName}`,
        workspaceGroup: `ash_${cleanName}_workspace`,
      }
    : null;

  // Live conflict checking with debounce
  useEffect(() => {
    if (!cleanName) {
      setConflicts(null);
      return;
    }
    const timer = setTimeout(() => {
      checkConflicts.mutate(cleanName, {
        onSuccess: (data) => setConflicts({ users: data.data.users, groups: data.data.groups }),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [cleanName]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasConflicts = conflicts && (conflicts.users.length > 0 || conflicts.groups.length > 0);
  const isValid = cleanName.length > 0 && !hasConflicts && !checkConflicts.isPending;

  const handleSubmit = useCallback(() => {
    if (!isValid) return;
    setupStore.baseName = cleanName;
    onNext(cleanName);
  }, [isValid, cleanName, onNext]);

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Configuration
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Choose a base name for sandbox users and groups. All names use the <code>ash_</code> prefix.
      </Typography>

      <TextField
        fullWidth
        label="Base Name"
        placeholder="myapp"
        value={baseName}
        onChange={e => setBaseName(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20))}
        autoFocus
        slotProps={{
          input: {
            startAdornment: <InputAdornment position="start">ash_</InputAdornment>,
            endAdornment: checkConflicts.isPending ? (
              <InputAdornment position="end"><CircularProgress size={18} /></InputAdornment>
            ) : undefined,
          },
        }}
        sx={{ mb: 3 }}
      />

      {preview && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Preview
            </Typography>
            {(['agentUser', 'brokerUser', 'socketGroup', 'workspaceGroup'] as const).map((key) => {
              const label = key === 'agentUser' ? 'Agent user'
                : key === 'brokerUser' ? 'Broker user'
                : key === 'socketGroup' ? 'Socket group'
                : 'Workspace group';
              const hasConflict =
                (key.endsWith('User') && conflicts?.users.includes(preview[key])) ||
                (key.endsWith('Group') && conflicts?.groups.includes(preview[key]));
              return (
                <Box key={key} sx={{ display: 'flex', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 130 }}>{label}</Typography>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    color={hasConflict ? 'error.main' : 'success.main'}
                  >
                    {preview[key]}
                    {hasConflict && ' (EXISTS)'}
                  </Typography>
                </Box>
              );
            })}
          </CardContent>
        </Card>
      )}

      {hasConflicts && (
        <Alert severity="error" icon={<AlertTriangle size={18} />} sx={{ mb: 2 }}>
          Existing users/groups found. Choose a different name or remove them first.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, mt: 3 }}>
        <Button
          variant="outlined"
          onClick={onBack}
          startIcon={<ArrowLeft size={16} />}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          disabled={!isValid}
          onClick={handleSubmit}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Continue
        </Button>
      </Box>
    </Box>
  );
}

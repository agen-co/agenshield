import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Alert,
  Autocomplete,
  Typography,
} from '@mui/material';
import type { PolicyConfig } from '@agenshield/ipc';
import { useSystemBins, useAllowedCommands } from '../../../api/hooks';

interface PolicyEditorProps {
  open: boolean;
  policy: PolicyConfig | null;
  onSave: (policy: PolicyConfig) => void;
  onClose: () => void;
  error?: boolean;
}

interface CommandOption {
  label: string;
  path?: string;
  source: 'allowed' | 'system';
}

export function PolicyEditor({ open, policy, onSave, onClose, error }: PolicyEditorProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'allowlist' as 'allowlist' | 'denylist',
    patterns: '',
    enabled: true,
  });

  const { data: binsData } = useSystemBins();
  const { data: allowedData } = useAllowedCommands();

  useEffect(() => {
    if (policy) {
      setFormData({
        name: policy.name,
        type: policy.type,
        patterns: policy.patterns.join('\n'),
        enabled: policy.enabled,
      });
    } else {
      setFormData({ name: '', type: 'allowlist', patterns: '', enabled: true });
    }
  }, [policy, open]);

  const commandOptions = useMemo(() => {
    const options: CommandOption[] = [];
    const seen = new Set<string>();

    // Allowed commands first
    if (allowedData?.data?.commands) {
      for (const cmd of allowedData.data.commands) {
        if (!seen.has(cmd.name)) {
          seen.add(cmd.name);
          options.push({
            label: cmd.name,
            path: cmd.paths[0],
            source: 'allowed',
          });
        }
      }
    }

    // System binaries
    if (binsData?.data?.bins) {
      for (const bin of binsData.data.bins) {
        if (!seen.has(bin.name)) {
          seen.add(bin.name);
          options.push({
            label: bin.name,
            path: bin.path,
            source: 'system',
          });
        }
      }
    }

    return options;
  }, [binsData, allowedData]);

  const handleSave = () => {
    const newPolicy: PolicyConfig = {
      id: policy?.id ?? crypto.randomUUID(),
      name: formData.name,
      type: formData.type,
      patterns: formData.patterns.split('\n').filter((p) => p.trim()),
      enabled: formData.enabled,
    };
    onSave(newPolicy);
  };

  const handleAddCommand = (_event: unknown, value: CommandOption | null) => {
    if (!value) return;
    const current = formData.patterns.trim();
    const newPattern = current ? `${current}\n${value.label}` : value.label;
    setFormData({ ...formData, patterns: newPattern });
  };

  const handleClose = () => {
    if (policy) {
      setFormData({
        name: policy.name,
        type: policy.type,
        patterns: policy.patterns.join('\n'),
        enabled: policy.enabled,
      });
    } else {
      setFormData({ name: '', type: 'allowlist', patterns: '', enabled: true });
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{policy ? 'Edit Policy' : 'Add Policy'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          {error && (
            <Alert severity="error">
              Failed to update policies. Please try again.
            </Alert>
          )}
          <TextField
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            fullWidth
            placeholder="e.g. Allow internal APIs"
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={formData.type}
              label="Type"
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as 'allowlist' | 'denylist' })
              }
            >
              <MenuItem value="allowlist">Allowlist</MenuItem>
              <MenuItem value="denylist">Denylist</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Patterns (one per line)"
            value={formData.patterns}
            onChange={(e) => setFormData({ ...formData, patterns: e.target.value })}
            multiline
            rows={4}
            fullWidth
            placeholder={"*.example.com\nhttps://api.safe.com/*"}
          />
          {commandOptions.length > 0 && (
            <Autocomplete
              options={commandOptions}
              getOptionLabel={(option) => option.label}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2">{option.label}</Typography>
                  {option.path && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                      {option.path}
                    </Typography>
                  )}
                </Box>
              )}
              onChange={handleAddCommand}
              value={null}
              blurOnSelect
              clearOnBlur
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Add command"
                  placeholder="Search system commands..."
                  size="small"
                />
              )}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} variant="outlined" color="secondary">Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!formData.name || !formData.patterns}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

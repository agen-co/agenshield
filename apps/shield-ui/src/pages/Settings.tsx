/**
 * Settings page
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Button,
  Alert,
  Divider,
  Grid2 as Grid,
  Typography,
} from '@mui/material';
import { Save } from 'lucide-react';
import type { DaemonConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();
  const { isReadOnly } = useAuth();

  const defaults: DaemonConfig = {
    port: 6969,
    host: 'localhost',
    logLevel: 'info',
    enableHostsEntry: false,
  };

  const [formData, setFormData] = useState<DaemonConfig>(defaults);
  const [hasChanges, setHasChanges] = useState(false);
  const savedRef = useRef<DaemonConfig>(defaults);

  useEffect(() => {
    if (config?.data?.daemon && !hasChanges) {
      setFormData(config.data.daemon);
      savedRef.current = config.data.daemon;
    }
  }, [config?.data, hasChanges]);

  const handleChange = <K extends keyof DaemonConfig>(key: K, value: DaemonConfig[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateConfig.mutate(
      { daemon: formData },
      {
        onSuccess: () => {
          savedRef.current = formData;
          setHasChanges(false);
        },
      }
    );
  };

  const handleReset = () => {
    setFormData(savedRef.current);
    setHasChanges(false);
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Settings"
        description="Configure your AgenShield daemon settings."
      />

      {updateConfig.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Settings saved successfully. Restart the daemon for changes to take effect.
        </Alert>
      )}

      {updateConfig.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to save settings. Please try again.
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Server Configuration
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Configure how the daemon server listens for connections.
          </Typography>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Host"
                value={formData.host}
                onChange={(e) => handleChange('host', e.target.value)}
                fullWidth
                helperText="Hostname or IP address to bind to"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Port"
                type="number"
                value={formData.port}
                onChange={(e) => handleChange('port', parseInt(e.target.value, 10))}
                fullWidth
                inputProps={{ min: 1, max: 65535 }}
                helperText="Port number (1-65535)"
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 4 }} />

          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Logging
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Configure logging verbosity.
          </Typography>

          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Log Level</InputLabel>
            <Select
              value={formData.logLevel}
              label="Log Level"
              onChange={(e) =>
                handleChange('logLevel', e.target.value as DaemonConfig['logLevel'])
              }
            >
              <MenuItem value="debug">Debug</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="warn">Warning</MenuItem>
              <MenuItem value="error">Error</MenuItem>
            </Select>
          </FormControl>

          <Divider sx={{ my: 4 }} />

          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Advanced
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Advanced configuration options.
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={formData.enableHostsEntry}
                onChange={(e) => handleChange('enableHostsEntry', e.target.checked)}
              />
            }
            label="Add agen.shield to /etc/hosts"
            sx={{ ml: 0, gap: 1.5 }}
          />
          <Box sx={{ typography: 'caption', color: 'text.secondary', mt: 0.5, display: 'block' }}>
            Allows accessing the dashboard at http://agen.shield:6969 (requires sudo)
          </Box>

          <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              startIcon={<Save size={16} />}
              onClick={handleSave}
              disabled={!hasChanges || updateConfig.isPending || isReadOnly}
            >
              {updateConfig.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
            {hasChanges && (
              <Button variant="outlined" color="secondary" onClick={handleReset}>
                Reset
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

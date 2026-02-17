import { useState, useCallback } from 'react';
import { TextField, Typography, Box, Alert } from '@mui/material';
import { Play } from 'lucide-react';
import { PrimaryButton } from '../../../elements';
import { CircularLoader } from '../../../elements';
import { useSimulate } from '../../../api/hooks';
import { SimulationResults } from '../SimulationResults';
import { CommandInputBox, ActionsRow } from './SimulatePanel.styles';

export function SimulatePanel() {
  const [command, setCommand] = useState('');
  const simulate = useSimulate();

  const handleRun = useCallback(() => {
    if (!command.trim()) return;
    simulate.mutate({ command: command.trim() });
  }, [command, simulate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun],
  );

  return (
    <Box>
      <CommandInputBox>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          placeholder="wget https://example.com && rm -rf /tmp/test"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={simulate.isPending}
          InputProps={{
            sx: { fontFamily: '"IBM Plex Mono", monospace', fontSize: '0.875rem' },
          }}
          size="small"
        />

        <ActionsRow>
          <PrimaryButton
            startIcon={simulate.isPending ? <CircularLoader size={14} /> : <Play size={14} />}
            onClick={handleRun}
            disabled={!command.trim() || simulate.isPending}
            size="small"
          >
            {simulate.isPending ? 'Simulating...' : 'Simulate'}
          </PrimaryButton>

          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {'\u2318'}+Enter to run
          </Typography>
        </ActionsRow>
      </CommandInputBox>

      {/* Error display */}
      {simulate.isError && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error" variant="outlined">
            {simulate.error instanceof Error ? simulate.error.message : 'Simulation failed'}
          </Alert>
        </Box>
      )}

      {/* Results */}
      {simulate.data?.data && (
        <SimulationResults data={simulate.data.data} />
      )}
    </Box>
  );
}

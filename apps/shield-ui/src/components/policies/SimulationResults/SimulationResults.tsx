import { useState } from 'react';
import { Box, Chip, Typography, Collapse, Button } from '@mui/material';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SimulateResponse } from '@agenshield/ipc';
import { OperationRow } from '../OperationRow';
import { SummaryBar, OutputBlock } from './SimulationResults.styles';

interface SimulationResultsProps {
  data: SimulateResponse;
}

export function SimulationResults({ data }: SimulationResultsProps) {
  const [outputOpen, setOutputOpen] = useState(false);
  const hasOutput = !!(data.stdout.trim() || data.stderr.trim());

  return (
    <Box>
      {/* Summary bar */}
      <SummaryBar>
        <Chip label={`Total: ${data.summary.total}`} size="small" variant="outlined" />
        <Chip label={`Allowed: ${data.summary.allowed}`} size="small" color="success" variant="outlined" />
        <Chip label={`Denied: ${data.summary.denied}`} size="small" color="error" variant="outlined" />
        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {data.durationMs}ms
          {data.status === 'timeout' && ' (timeout)'}
          {data.exitCode !== null && ` · exit ${data.exitCode}`}
        </Typography>
      </SummaryBar>

      {/* Operations list */}
      <Box>
        {data.operations.length === 0 ? (
          <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
            No operations captured.
          </Typography>
        ) : (
          data.operations.map((op) => (
            <OperationRow key={op.id} operation={op} />
          ))
        )}
      </Box>

      {/* Collapsible process output */}
      {hasOutput && (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          <Button
            size="small"
            variant="text"
            color="secondary"
            startIcon={outputOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            onClick={() => setOutputOpen(!outputOpen)}
            sx={{ m: 1, textTransform: 'none' }}
          >
            Process output
          </Button>

          <Collapse in={outputOpen} unmountOnExit>
            <Box sx={{ px: 2, pb: 2 }}>
              {data.stdout.trim() && (
                <>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>stdout</Typography>
                  <OutputBlock>{data.stdout}</OutputBlock>
                </>
              )}
              {data.stderr.trim() && (
                <Box sx={{ mt: data.stdout.trim() ? 1.5 : 0 }}>
                  <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>stderr</Typography>
                  <OutputBlock>{data.stderr}</OutputBlock>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}

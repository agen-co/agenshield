import { Chip, Tooltip, Box } from '@mui/material';
import { Terminal, Globe, FolderOpen } from 'lucide-react';
import type { SimulatedOperation } from '@agenshield/ipc';
import { RowContainer, SeqNumber, TargetText, MetaText } from './OperationRow.styles';

const TYPE_ICON: Record<string, React.ReactNode> = {
  exec: <Terminal size={14} />,
  http_request: <Globe size={14} />,
  file_write: <FolderOpen size={14} />,
  file_read: <FolderOpen size={14} />,
};

const TYPE_LABEL: Record<string, string> = {
  exec: 'Exec',
  http_request: 'HTTP',
  file_write: 'Write',
  file_read: 'Read',
};

interface OperationRowProps {
  operation: SimulatedOperation;
}

export function OperationRow({ operation }: OperationRowProps) {
  return (
    <RowContainer>
      <SeqNumber>{operation.seq + 1}</SeqNumber>

      <Tooltip title={TYPE_LABEL[operation.type] ?? operation.type} placement="top">
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
          {TYPE_ICON[operation.type] ?? <Terminal size={14} />}
        </Box>
      </Tooltip>

      <Tooltip title={operation.target} placement="top-start">
        <TargetText>{operation.target}</TargetText>
      </Tooltip>

      <Chip
        label={operation.action}
        size="small"
        color={operation.action === 'allow' ? 'success' : 'error'}
        sx={{ fontWeight: 600, fontSize: '0.6875rem', height: 20, textTransform: 'uppercase' }}
      />

      {operation.policyName && (
        <MetaText>{operation.policyName}</MetaText>
      )}

      {operation.action === 'deny' && operation.reason && (
        <MetaText sx={{ fontStyle: 'italic' }}>{operation.reason}</MetaText>
      )}
    </RowContainer>
  );
}

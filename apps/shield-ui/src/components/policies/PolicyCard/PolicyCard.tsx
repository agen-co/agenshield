import { Typography, Switch, IconButton, Box, Chip } from '@mui/material';
import { Pencil, Trash2 } from 'lucide-react';
import { StatusBadge } from '../../shared/StatusBadge';
import { Root, Header, Footer } from './PolicyCard.styles';
import type { PolicyCardProps } from './PolicyCard.types';

const ACTION_VARIANT: Record<string, 'success' | 'error' | 'warning'> = {
  allow: 'success',
  deny: 'error',
  approval: 'warning',
};

const TARGET_LABEL: Record<string, string> = {
  command: 'Command',
  skill: 'Skill',
  url: 'URL',
  filesystem: 'Filesystem',
};

export function PolicyCard({
  policy,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: PolicyCardProps) {
  return (
    <Root onClick={onEdit}>
      <Header>
        <Typography variant="subtitle2" fontWeight={600}>
          {policy.name}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <StatusBadge
            label={policy.action}
            variant={ACTION_VARIANT[policy.action] ?? 'success'}
            dot={false}
            size="small"
          />
          <Chip
            size="small"
            label={TARGET_LABEL[policy.target] ?? policy.target}
            variant="outlined"
            sx={{ fontSize: 11, height: 20 }}
          />
        </Box>
      </Header>

      <Typography variant="body2" color="text.secondary">
        {policy.patterns.length} pattern{policy.patterns.length !== 1 ? 's' : ''}
      </Typography>

      <Footer>
        <Switch
          size="small"
          checked={policy.enabled}
          onChange={(e) => {
            e.stopPropagation();
            onToggle(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
        />
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={14} />
          </IconButton>
        </Box>
      </Footer>
    </Root>
  );
}

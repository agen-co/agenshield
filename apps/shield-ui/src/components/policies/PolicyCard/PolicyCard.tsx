import { Typography, Switch, IconButton, Box } from '@mui/material';
import { Pencil, Trash2 } from 'lucide-react';
import { StatusBadge } from '../../shared/StatusBadge';
import { Root, Header, Footer } from './PolicyCard.styles';
import type { PolicyCardProps } from './PolicyCard.types';

export function PolicyCard({
  policy,
  selected = false,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: PolicyCardProps) {
  return (
    <Root $selected={selected} onClick={onSelect}>
      <Header>
        <Typography variant="subtitle2" fontWeight={600}>
          {policy.name}
        </Typography>
        <StatusBadge
          label={policy.type}
          variant={policy.type === 'allowlist' ? 'success' : 'error'}
          dot={false}
          size="small"
        />
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

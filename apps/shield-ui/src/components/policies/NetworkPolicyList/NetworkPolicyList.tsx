import { memo } from 'react';
import { Typography, Switch, IconButton, Box, Chip } from '@mui/material';
import { Pencil, Trash2 } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { StatusBadge } from '../../shared/StatusBadge';
import { PolicyRow, PolicyName, PolicyMeta } from '../PolicyList/PolicyList.styles';

const ACTION_VARIANT: Record<string, 'success' | 'error' | 'warning'> = {
  allow: 'success',
  deny: 'error',
  approval: 'warning',
};

interface NetworkPolicyListProps {
  policies: PolicyConfig[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
  busy?: boolean;
}

/* ── Memoized row ─────────────────────────────────────────── */

interface NetworkRowProps {
  policy: PolicyConfig;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}

const NetworkRow = memo(function NetworkRow({
  policy,
  onToggle,
  onEdit,
  onDelete,
  busy,
}: NetworkRowProps) {
  return (
    <PolicyRow onClick={() => onEdit(policy)}>
      <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
        <Switch
          checked={policy.enabled}
          onChange={(e) => onToggle(policy.id, e.target.checked)}
          disabled={busy}
        />
      </Box>

      <PolicyName>
        <Typography variant="body2" fontWeight={500} noWrap>
          {policy.name}
        </Typography>
      </PolicyName>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {policy.patterns.slice(0, 6).map((p) => (
          <Chip
            key={p}
            size="small"
            label={p}
            variant="outlined"
            sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, height: 20 }}
          />
        ))}
        {policy.patterns.length > 6 && (
          <Chip
            size="small"
            label={`+${policy.patterns.length - 6}`}
            variant="outlined"
            sx={{ fontSize: 11, height: 20 }}
          />
        )}
      </Box>

      <PolicyMeta>
        <StatusBadge
          label={policy.action}
          variant={ACTION_VARIANT[policy.action] ?? 'success'}
          dot={false}
          size="small"
        />
        {policy.preset && (
          <Chip
            size="small"
            label={policy.preset === 'openclaw' ? 'OpenClaw' : policy.preset}
            color="info"
            variant="outlined"
            sx={{ fontSize: 10, height: 18 }}
          />
        )}
      </PolicyMeta>

      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onEdit(policy); }}
        >
          <Pencil size={14} />
        </IconButton>
        <IconButton
          size="small"
          color="error"
          onClick={(e) => { e.stopPropagation(); onDelete(policy.id); }}
          disabled={busy}
        >
          <Trash2 size={14} />
        </IconButton>
      </Box>
    </PolicyRow>
  );
}, (prev, next) => {
  if (prev.busy !== next.busy) return false;
  if (prev.onToggle !== next.onToggle || prev.onEdit !== next.onEdit || prev.onDelete !== next.onDelete) return false;
  const a = prev.policy, b = next.policy;
  return a.id === b.id && a.enabled === b.enabled && a.name === b.name &&
    a.action === b.action && a.preset === b.preset &&
    a.patterns.length === b.patterns.length &&
    a.patterns.every((p, i) => p === b.patterns[i]);
});

/* ── List component ───────────────────────────────────────── */

export function NetworkPolicyList({
  policies,
  onToggle,
  onEdit,
  onDelete,
  readOnly,
  busy,
}: NetworkPolicyListProps) {
  return (
    <Box>
      {policies.map((policy) => (
        <NetworkRow
          key={policy.id}
          policy={policy}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          busy={busy}
        />
      ))}
    </Box>
  );
}

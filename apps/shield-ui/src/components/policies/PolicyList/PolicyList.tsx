import { useMemo } from 'react';
import { Typography, Switch, IconButton, Box, Chip } from '@mui/material';
import { Pencil, Trash2, KeyRound } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import type { Secret } from '../../../api/client';
import { StatusBadge } from '../../shared/StatusBadge';
import { PolicyRow, PolicyName, PolicyMeta, PolicySecrets } from './PolicyList.styles';

interface PolicyListProps {
  policies: PolicyConfig[];
  secrets: Secret[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
  busy?: boolean;
}

const ACTION_VARIANT: Record<string, 'success' | 'error' | 'warning'> = {
  allow: 'success',
  deny: 'error',
  approval: 'warning',
};

const TARGET_LABEL: Record<string, string> = {
  command: 'Command',
  skill: 'Skill',
  url: 'URL',
};

export function PolicyList({
  policies,
  secrets,
  onToggle,
  onEdit,
  onDelete,
  readOnly,
  busy,
}: PolicyListProps) {
  // Build reverse map: policyId → secrets linked to it
  const policySecretsMap = useMemo(() => {
    const map = new Map<string, Secret[]>();
    for (const secret of secrets) {
      for (const pid of secret.policyIds) {
        const list = map.get(pid) ?? [];
        list.push(secret);
        map.set(pid, list);
      }
    }
    return map;
  }, [secrets]);

  return (
    <Box>
      {policies.map((policy) => {
        const linked = policySecretsMap.get(policy.id) ?? [];
        return (
          <PolicyRow key={policy.id} onClick={() => !readOnly && onEdit(policy)}>
            <Box
              onClick={(e) => e.stopPropagation()}
              sx={{ flexShrink: 0 }}
            >
              <Switch
                checked={policy.enabled}
                onChange={(e) => {
                  onToggle(policy.id, e.target.checked);
                }}
                disabled={readOnly || busy}
              />
            </Box>

            <PolicyName>
              <Typography variant="body2" fontWeight={500} noWrap>
                {policy.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {policy.patterns.length} pattern{policy.patterns.length !== 1 ? 's' : ''}
              </Typography>
            </PolicyName>

            <PolicyMeta>
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
            </PolicyMeta>

            <PolicySecrets>
              {linked.length === 0 ? (
                <Typography variant="caption" color="text.disabled">
                  No secrets
                </Typography>
              ) : (
                linked.map((secret) => (
                  <Chip
                    key={secret.id}
                    size="small"
                    icon={<KeyRound size={10} />}
                    label={secret.name}
                    variant="outlined"
                    sx={{ fontSize: 11, height: 22 }}
                  />
                ))
              )}
            </PolicySecrets>

            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onEdit(policy); }}
                disabled={readOnly}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={(e) => { e.stopPropagation(); onDelete(policy.id); }}
                disabled={readOnly || busy}
              >
                <Trash2 size={14} />
              </IconButton>
            </Box>
          </PolicyRow>
        );
      })}
    </Box>
  );
}

import { useMemo } from 'react';
import { Typography, IconButton, Box, Chip } from '@mui/material';
import { Trash2, Globe, Archive } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import type { Secret } from '../../../api/client';
import { useConfig } from '../../../api/hooks';
import { SecretRow, SecretName, SecretValue } from './SecretsList.styles';

interface SecretsListProps {
  secrets: Secret[];
  search: string;
  onDelete: (id: string) => void;
  onEdit: (secret: Secret) => void;
}

const ACTION_LABEL: Record<string, string> = { allow: 'Allow', deny: 'Deny', approval: 'Approval' };
const TARGET_LABEL: Record<string, string> = { command: 'Cmd', skill: 'Skill', url: 'URL' };

export function SecretsList({ secrets, search, onDelete, onEdit }: SecretsListProps) {
  const { data: configData } = useConfig();
  const policies = configData?.data?.policies ?? [];

  const policyMap = useMemo(() => {
    const map = new Map<string, PolicyConfig>();
    for (const p of policies) {
      map.set(p.id, p);
    }
    return map;
  }, [policies]);

  const filtered = useMemo(() => {
    if (!search) return secrets;
    const q = search.toLowerCase();
    return secrets.filter((s) => s.name.toLowerCase().includes(q));
  }, [secrets, search]);

  return (
    <Box>
      {filtered.map((secret) => (
        <SecretRow key={secret.id} onClick={() => onEdit(secret)}>
          <SecretName>
            <Typography variant="body2" fontWeight={500}>
              {secret.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Created {new Date(secret.createdAt).toLocaleDateString()}
            </Typography>
          </SecretName>
          <SecretValue>{secret.maskedValue}</SecretValue>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {secret.scope === 'standalone' ? (
              <Chip
                size="small"
                icon={<Archive size={12} />}
                label="Standalone"
                variant="outlined"
                sx={{ fontSize: 11, height: 22 }}
              />
            ) : secret.policyIds.length === 0 ? (
              <Chip
                size="small"
                icon={<Globe size={12} />}
                label="Global"
                variant="outlined"
                sx={{ fontSize: 11, height: 22 }}
              />
            ) : (
              secret.policyIds.map((pid) => {
                const p = policyMap.get(pid);
                const label = p
                  ? `${p.name} · ${ACTION_LABEL[p.action] ?? p.action}`
                  : pid;
                return (
                  <Chip
                    key={pid}
                    size="small"
                    label={label}
                    variant="outlined"
                    color={p?.action === 'allow' ? 'success' : p?.action === 'deny' ? 'error' : undefined}
                    sx={{ fontSize: 11, height: 22 }}
                  />
                );
              })
            )}
          </Box>
          <IconButton
            size="small"
            color="error"
            onClick={(e) => { e.stopPropagation(); onDelete(secret.id); }}
          >
            <Trash2 size={14} />
          </IconButton>
        </SecretRow>
      ))}
    </Box>
  );
}

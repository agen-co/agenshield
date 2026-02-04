import { useMemo } from 'react';
import { Typography, IconButton, Box } from '@mui/material';
import { Trash2, Globe, Terminal, Link, Zap } from 'lucide-react';
import type { Secret } from '../../../api/client';
import { SecretRow, SecretName, SecretValue, ScopeTag, GroupHeader } from './SecretsList.styles';

interface SecretsListProps {
  secrets: Secret[];
  search: string;
  onDelete: (id: string) => void;
}

function scopeLabel(secret: Secret): string {
  switch (secret.scope.type) {
    case 'global': return 'Global';
    case 'command': return `Command: ${secret.scope.pattern}`;
    case 'url': return `URL: ${secret.scope.pattern}`;
    case 'skill': return `Skill: ${secret.scope.skillId}`;
  }
}

function ScopeIcon({ type }: { type: string }) {
  switch (type) {
    case 'command': return <Terminal size={12} />;
    case 'url': return <Link size={12} />;
    case 'skill': return <Zap size={12} />;
    default: return <Globe size={12} />;
  }
}

const scopeOrder = ['global', 'command', 'url', 'skill'];
const scopeLabels: Record<string, string> = {
  global: 'Global Secrets',
  command: 'Command Secrets',
  url: 'URL Secrets',
  skill: 'Skill Secrets',
};

export function SecretsList({ secrets, search, onDelete }: SecretsListProps) {
  const filtered = useMemo(() => {
    if (!search) return secrets;
    const q = search.toLowerCase();
    return secrets.filter((s) => s.name.toLowerCase().includes(q));
  }, [secrets, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Secret[]>();
    for (const secret of filtered) {
      const type = secret.scope.type;
      const list = groups.get(type) ?? [];
      list.push(secret);
      groups.set(type, list);
    }
    return groups;
  }, [filtered]);

  return (
    <Box>
      {scopeOrder.map((type) => {
        const items = grouped.get(type);
        if (!items?.length) return null;

        return (
          <Box key={type}>
            <GroupHeader>{scopeLabels[type]}</GroupHeader>
            {items.map((secret) => (
              <SecretRow key={secret.id}>
                <SecretName>
                  <Typography variant="body2" fontWeight={500}>
                    {secret.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Created {new Date(secret.createdAt).toLocaleDateString()}
                  </Typography>
                </SecretName>
                <SecretValue>{secret.maskedValue}</SecretValue>
                <ScopeTag>
                  <ScopeIcon type={secret.scope.type} />
                  {scopeLabel(secret)}
                </ScopeTag>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onDelete(secret.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </SecretRow>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

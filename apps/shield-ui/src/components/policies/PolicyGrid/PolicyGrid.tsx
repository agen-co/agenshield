import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyCard } from '../PolicyCard';
import { Root } from './PolicyGrid.styles';

interface PolicyGridProps {
  policies: PolicyConfig[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function PolicyGrid({
  policies,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: PolicyGridProps) {
  return (
    <Root>
      {policies.map((policy) => (
        <PolicyCard
          key={policy.id}
          policy={policy}
          onToggle={(enabled) => onToggle(policy.id, enabled)}
          onEdit={() => onEdit(policy)}
          onDelete={() => onDelete(policy.id)}
          disabled={disabled}
        />
      ))}
    </Root>
  );
}

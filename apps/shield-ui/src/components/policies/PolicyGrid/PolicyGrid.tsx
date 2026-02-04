import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyCard } from '../PolicyCard';
import { Root } from './PolicyGrid.styles';

interface PolicyGridProps {
  policies: PolicyConfig[];
  selectedId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function PolicyGrid({
  policies,
  selectedId,
  collapsed,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: PolicyGridProps) {
  return (
    <Root $collapsed={collapsed}>
      {policies.map((policy) => (
        <PolicyCard
          key={policy.id}
          policy={policy}
          selected={selectedId === policy.id}
          onSelect={() => onSelect(policy.id)}
          onToggle={(enabled) => onToggle(policy.id, enabled)}
          onEdit={() => onEdit(policy)}
          onDelete={() => onDelete(policy.id)}
          disabled={disabled}
        />
      ))}
    </Root>
  );
}

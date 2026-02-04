import type { PolicyConfig } from '@agenshield/ipc';

export interface PolicyCardProps {
  policy: PolicyConfig;
  selected?: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

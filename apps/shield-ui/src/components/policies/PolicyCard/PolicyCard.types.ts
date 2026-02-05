import type { PolicyConfig } from '@agenshield/ipc';

export interface PolicyCardProps {
  policy: PolicyConfig;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

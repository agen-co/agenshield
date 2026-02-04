export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

export interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  size?: 'small' | 'medium';
  dot?: boolean;
}

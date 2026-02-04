import { Root, Dot } from './StatusBadge.styles';
import type { StatusBadgeProps } from './StatusBadge.types';

export function StatusBadge({ label, variant = 'default', size = 'small', dot = true }: StatusBadgeProps) {
  return (
    <Root $variant={variant} $size={size}>
      {dot && <Dot $variant={variant} />}
      {label}
    </Root>
  );
}

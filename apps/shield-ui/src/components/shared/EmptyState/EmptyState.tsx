import { Typography } from '@mui/material';
import { Root, IconContainer } from './EmptyState.styles';
import type { EmptyStateProps } from './EmptyState.types';

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Root>
      {icon && <IconContainer>{icon}</IconContainer>}
      <Typography variant="h6" fontWeight={500}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
          {description}
        </Typography>
      )}
      {action}
    </Root>
  );
}

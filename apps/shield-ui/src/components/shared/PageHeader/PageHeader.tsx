import { Typography } from '@mui/material';
import { Root, TitleGroup } from './PageHeader.styles';
import type { PageHeaderProps } from './PageHeader.types';

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Root>
      <TitleGroup>
        <Typography variant="h4" fontWeight={600}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" color="text.secondary">
            {description}
          </Typography>
        )}
      </TitleGroup>
      {action}
    </Root>
  );
}

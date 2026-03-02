import { Card, CardContent, Typography, Box, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { IconBox, InlineIconBox } from './Card.styles';
import type { StatCardProps } from './Card.types';

export function StatCard({ title, value, icon, color, loading, inline }: StatCardProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.palette.primary.main;

  if (inline) {
    return (
      <Card>
        <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 0.75 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InlineIconBox $color={resolvedColor}>{icon}</InlineIconBox>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {title}
            </Typography>
            {loading ? (
              <Skeleton variant="text" width={40} />
            ) : (
              <Typography variant="subtitle2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                {value}
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <IconBox $color={resolvedColor}>{icon}</IconBox>
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {title}
        </Typography>
        {loading ? (
          <Skeleton variant="text" width="60%" />
        ) : (
          <Typography variant="h5" fontWeight={600}>
            {value}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

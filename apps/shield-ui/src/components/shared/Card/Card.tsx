import { Card, CardContent, Typography, Box, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { IconBox } from './Card.styles';
import type { StatCardProps } from './Card.types';

export function StatCard({ title, value, icon, color, loading }: StatCardProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.palette.primary.main;

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

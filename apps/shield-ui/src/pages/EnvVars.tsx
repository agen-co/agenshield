/**
 * Environment Variables page — placeholder
 */

import { Box } from '@mui/material';
import { Variable } from 'lucide-react';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';

export function EnvVars() {
  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Environment Variables"
        description="Manage environment variables for this profile."
      />

      <EmptyState
        icon={<Variable size={28} />}
        title="Coming soon"
        description="Environment variable management will be available in a future release."
      />
    </Box>
  );
}

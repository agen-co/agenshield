import { Box } from '@mui/material';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { AgentIdentityCard } from '../components/settings/AgentIdentityCard';
import { ServerConfigCard } from '../components/settings/ServerConfigCard';
import { LoggingCard } from '../components/settings/LoggingCard';
import { AdvancedCard } from '../components/settings/AdvancedCard';
import { DangerZoneCard } from '../components/settings/DangerZoneCard';

export function Settings() {
  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Settings"
        description="Configure your AgenShield daemon settings."
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <AgentIdentityCard />
        <ServerConfigCard />
        <LoggingCard />
        <AdvancedCard />
        <DangerZoneCard />
      </Box>
    </Box>
  );
}

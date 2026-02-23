import { Box } from '@mui/material';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { AgentIdentityCard } from '../components/settings/AgentIdentityCard';
import { ServerConfigCard } from '../components/settings/ServerConfigCard';
import { OpenClawCard } from '../components/settings/OpenClawCard';
import { LoggingCard } from '../components/settings/LoggingCard';
import { AdvancedCard } from '../components/settings/AdvancedCard';
import { DangerZoneCard } from '../components/settings/DangerZoneCard';

export function Settings({ embedded, profileId }: { embedded?: boolean; profileId?: string | null } = {}) {
  return (
    <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {!embedded && (
        <PageHeader
          title="Settings"
          description="Configure your AgenShield daemon settings."
        />
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <AgentIdentityCard profileId={profileId} />
        <ServerConfigCard />
        <OpenClawCard />
        <LoggingCard />
        <AdvancedCard />
        <DangerZoneCard />
      </Box>
    </Box>
  );
}

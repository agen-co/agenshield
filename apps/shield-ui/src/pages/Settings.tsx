import { Box } from '@mui/material';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { AgentIdentityCard } from '../components/settings/AgentIdentityCard';
import { ServerConfigCard } from '../components/settings/ServerConfigCard';
import { LoggingCard } from '../components/settings/LoggingCard';
import { AdvancedCard } from '../components/settings/AdvancedCard';
import { KeychainCard } from '../components/settings/KeychainCard';
import { ICloudBackupCard } from '../components/settings/ICloudBackupCard';
import { DangerZoneCard } from '../components/settings/DangerZoneCard';
import { UnshieldCard } from '../components/settings/UnshieldCard';

interface SettingsProps {
  embedded?: boolean;
  profileId?: string | null;
  targetId?: string;
}

export function Settings({ embedded, profileId, targetId }: SettingsProps = {}) {
  const isTargetMode = embedded && !!profileId;

  return (
    <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {!embedded && (
        <PageHeader
          title="Settings"
          description="Configure your AgenShield daemon settings."
        />
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {isTargetMode ? (
          <>
            <AgentIdentityCard profileId={profileId} />
            {targetId && <UnshieldCard targetId={targetId} />}
          </>
        ) : (
          <>
            <ServerConfigCard />
            <LoggingCard />
            <KeychainCard />
            <ICloudBackupCard />
            <AdvancedCard />
            <DangerZoneCard />
          </>
        )}
      </Box>
    </Box>
  );
}

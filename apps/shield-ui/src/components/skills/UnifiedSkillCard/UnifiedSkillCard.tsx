import { Typography, Chip, Box, Button, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Zap, Download, Search, Trash2 } from 'lucide-react';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import { VulnBadge } from '../../shared/VulnBadge';
import { CardRoot, SkillIcon, Row } from './UnifiedSkillCard.styles';
import type { UnifiedSkillCardProps } from './UnifiedSkillCard.types';

const originChipConfig: Record<string, { label: string; color: 'warning' | 'default' }> = {
  blocked: { label: 'Blocked', color: 'warning' },
  local: { label: 'Local', color: 'default' },
  untrusted: { label: 'Untrusted', color: 'warning' },
};

export function UnifiedSkillCard({ skill, selected = false, readOnly = false, onClick, onAction, onDelete }: UnifiedSkillCardProps) {
  const theme = useTheme();
  const vulnLevel = skill.analysis?.vulnerability?.level;
  const chipConfig = originChipConfig[skill.origin];
  const commands = skill.analysis?.commands;
  const envVars = skill.envVariables ?? skill.analysis?.envVariables;

  const hasTags = skill.tags && skill.tags.length > 0;
  const hasDescription = !!skill.description;
  const hasCommands = commands && commands.length > 0;
  const hasEnvVars = envVars && envVars.length > 0;
  const isUntrusted = skill.origin === 'untrusted';

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction?.(e);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(e);
  };

  return (
    <CardRoot $selected={selected} onClick={onClick}>
      {/* Row 1: Title + action button */}
      <Row>
        <SkillIcon $color={theme.palette.primary.main}>
          <Zap size={14} />
        </SkillIcon>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {skill.name}
            </Typography>
            {chipConfig && (
              <Chip
                label={chipConfig.label}
                color={chipConfig.color}
                size="small"
                sx={{ fontWeight: 500, height: 18, fontSize: '0.625rem' }}
              />
            )}
            {vulnLevel && skill.actionState !== 'analysis_failed' && <VulnBadge level={vulnLevel} size="compact" />}
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {skill.author}{skill.version ? ` · v${skill.version}` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <ActionButton actionState={skill.actionState} vulnLevel={vulnLevel} onClick={handleAction} />
          {isUntrusted && onDelete && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={handleDelete}
              sx={{ minWidth: 'auto', px: 0.75, flexShrink: 0 }}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </Box>
      </Row>

      {/* Row 2: Tags — comma separated, code font, grey */}
      <Row sx={{ minHeight: 20 }}>
        <Typography
          variant="caption"
          color="text.disabled"
          fontFamily="'IBM Plex Mono', monospace"
          noWrap
          sx={hasTags ? { color: 'text.secondary' } : { opacity: 0.5 }}
        >
          {hasTags ? skill.tags!.join(', ') : 'No tags'}
        </Typography>
      </Row>

      {/* Row 3: Description — 2 lines */}
      <Row sx={{ minHeight: 40, ...(hasDescription ? {} : { justifyContent: 'center' }) }}>
        <Typography
          variant="body2"
          color={hasDescription ? 'text.secondary' : 'text.disabled'}
          sx={hasDescription
            ? {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.43,
              }
            : { opacity: 0.5, fontStyle: 'italic' }
          }
        >
          {hasDescription ? skill.description : 'No description'}
        </Typography>
      </Row>

      {/* Row 4: Commands — chips */}
      <Row sx={{ minHeight: 24 }}>
        {hasCommands ? (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap', overflow: 'hidden' }}>
            {commands!.map((cmd) => (
              <Chip
                key={cmd.name}
                label={cmd.name}
                size="small"
                color={cmd.available ? 'default' : 'error'}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.625rem', fontFamily: "'IBM Plex Mono', monospace" }}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.disabled" sx={{ opacity: 0.5 }}>
            No commands detected
          </Typography>
        )}
      </Row>

      {/* Row 5: Environment variables — code font, comma separated */}
      <Row sx={{ minHeight: 20 }}>
        <Typography
          variant="caption"
          color="text.disabled"
          fontFamily="'IBM Plex Mono', monospace"
          noWrap
          sx={hasEnvVars ? { color: 'text.secondary' } : { opacity: 0.5 }}
        >
          {hasEnvVars ? envVars!.map((ev) => ev.name).join(', ') : 'No environment variables'}
        </Typography>
      </Row>
    </CardRoot>
  );
}

function ActionButton({
  actionState,
  vulnLevel,
  onClick,
}: {
  actionState: string;
  vulnLevel?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const sx = { flexShrink: 0, minWidth: 'auto', whiteSpace: 'nowrap' } as const;

  switch (actionState) {
    case 'not_analyzed':
      return (
        <PrimaryButton size="small" onClick={onClick} sx={sx}>
          <Search size={12} style={{ marginRight: 4 }} />
          Analyze
        </PrimaryButton>
      );
    case 'analyzing':
      return (
        <SecondaryButton size="small" disabled sx={sx}>
          <CircularLoader size={12} sx={{ mr: 0.5 }} />
          Analyzing
        </SecondaryButton>
      );
    case 'analysis_failed':
      return (
        <PrimaryButton size="small" onClick={onClick} sx={sx}>
          <Search size={12} style={{ marginRight: 4 }} />
          Analyze
        </PrimaryButton>
      );
    case 'analyzed':
      if (vulnLevel === 'critical') {
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <PrimaryButton size="small" disabled sx={sx}>
              <Download size={12} style={{ marginRight: 4 }} />
              Install
            </PrimaryButton>
            <Alert severity="error" sx={{ py: 0, px: 0.5, '& .MuiAlert-message': { fontSize: '0.625rem', p: 0 }, '& .MuiAlert-icon': { fontSize: 14, mr: 0.25, p: 0 } }}>
              Critical
            </Alert>
          </Box>
        );
      }
      return (
        <PrimaryButton size="small" onClick={onClick} sx={sx}>
          <Download size={12} style={{ marginRight: 4 }} />
          Install
        </PrimaryButton>
      );
    case 'installing':
      return (
        <PrimaryButton size="small" disabled sx={sx}>
          <CircularLoader size={12} sx={{ mr: 0.5 }} />
          Installing
        </PrimaryButton>
      );
    case 'installed':
      return (
        <Button size="small" variant="outlined" color="error" onClick={onClick} sx={sx}>
          Uninstall
        </Button>
      );
    case 'blocked':
      return <PrimaryButton size="small" onClick={onClick} sx={sx}>Unblock</PrimaryButton>;
    case 'untrusted':
      return (
        <SecondaryButton size="small" disabled sx={sx}>
          <CircularLoader size={12} sx={{ mr: 0.5 }} />
          Pending
        </SecondaryButton>
      );
    default:
      return null;
  }
}

import { Typography, Box, Chip, Card, CardContent, Badge } from '@mui/material';
import { CheckCircle, AlertTriangle, Info, Lightbulb, Plus, Puzzle } from 'lucide-react';
import type { SkillEnvRequirement } from '../../../api/client';
import { useSkillEnvRequirements } from '../../../api/hooks';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';

interface SkillEnvSectionProps {
  onAddSecret: (envName: string) => void;
  disabled?: boolean;
}

export function SkillEnvSection({ onAddSecret, disabled }: SkillEnvSectionProps) {
  const { data, isLoading } = useSkillEnvRequirements();

  const requirements: SkillEnvRequirement[] = data?.data ?? [];

  if (isLoading || requirements.length === 0) return null;

  const required = requirements.filter((r) => r.required);
  const suggested = requirements.filter((r) => !r.required);
  const missingRequiredCount = required.filter((r) => !r.fulfilled).length;
  const missingSuggestedCount = suggested.filter((r) => !r.fulfilled).length;

  const renderRow = (req: SkillEnvRequirement) => (
    <Box
      key={req.name}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
        '&:last-child': { borderBottom: 'none' },
      })}
    >
      {/* Status icon */}
      {req.fulfilled ? (
        <CheckCircle size={16} color="var(--mui-palette-success-main, #6CB685)" />
      ) : req.required ? (
        <AlertTriangle size={16} color="var(--mui-palette-warning-main, #EEA45F)" />
      ) : (
        <Info size={16} color="var(--mui-palette-info-main, #6BAEF2)" />
      )}

      {/* Name + purpose */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" fontFamily="'IBM Plex Mono', monospace" fontWeight={500}>
            {req.name}
          </Typography>
          {req.required ? (
            <Chip label="required" size="small" color="warning" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
          ) : (
            <Chip label="optional" size="small" color="info" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
          )}
          {req.sensitive && (
            <Chip label="sensitive" size="small" color="error" variant="outlined" sx={{ height: 16, fontSize: '0.6rem' }} />
          )}
        </Box>
        {req.purpose && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {req.purpose}
          </Typography>
        )}
      </Box>

      {/* Skill names */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flexShrink: 0 }}>
        {req.requiredBy.map((s) => (
          <Chip
            key={s.skillName}
            label={s.skillName}
            size="small"
            variant="outlined"
            sx={{ fontSize: 10, height: 18 }}
          />
        ))}
      </Box>

      {/* Add button for unfulfilled */}
      {!req.fulfilled && (
        <SecondaryButton
          size="small"
          onClick={() => onAddSecret(req.name)}
          sx={{ whiteSpace: 'nowrap', minWidth: 'auto', px: 1.5 }}
        >
          <Plus size={12} style={{ marginRight: 4 }} />
          Add
        </SecondaryButton>
      )}
    </Box>
  );

  return (
    <Card sx={{ mb: 3, opacity: disabled ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: disabled ? 'none' : 'auto' }}>
      <CardContent sx={{ p: '0 !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pt: 2, pb: 1 }}>
          <Puzzle size={16} />
          <Typography variant="subtitle2" fontWeight={600}>
            Skill Secrets
          </Typography>
          {missingRequiredCount > 0 && (
            <Badge badgeContent={missingRequiredCount} color="warning" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          )}
          {missingSuggestedCount > 0 && (
            <Badge badgeContent={missingSuggestedCount} color="info" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }} />
          )}
        </Box>

        {/* Required group */}
        {required.length > 0 && (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <AlertTriangle size={14} color="var(--mui-palette-warning-main, #EEA45F)" />
              <Typography variant="caption" fontWeight={600} color="warning.main">
                Required
              </Typography>
            </Box>
            {required.map(renderRow)}
          </>
        )}

        {/* Suggested group */}
        {suggested.length > 0 && (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Lightbulb size={14} color="var(--mui-palette-info-main, #6BAEF2)" />
              <Typography variant="caption" fontWeight={600} color="info.main">
                Suggested
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                — enhances skill functionality
              </Typography>
            </Box>
            {suggested.map(renderRow)}
          </>
        )}
      </CardContent>
    </Card>
  );
}

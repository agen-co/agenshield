/**
 * PolicyOverview — grouped summary of all policy types.
 *
 * Shows a section card for each policy target type (Commands, Network, Filesystem, Process)
 * plus a Policy Graph section. Each card shows a count and preview chips of top patterns.
 * Clicking navigates to the drill-down view.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Chip } from '@mui/material';
import { Terminal, Globe, FolderOpen, Cpu, GitBranch, ChevronRight } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { PolicyConfig } from '@agenshield/ipc';
import { useTieredPolicies } from '../../../api/hooks';
import { PolicyGraphPreview } from '../PolicyGraphPreview';
import {
  SectionCard,
  SectionHeader,
  SectionTitle,
  ChipRow,
} from './PolicyOverview.styles';
import type { PolicyOverviewProps } from './PolicyOverview.types';

const SECTIONS = [
  { key: 'commands', label: 'Commands', icon: Terminal, target: 'command' },
  { key: 'network', label: 'Network', icon: Globe, target: 'url' },
  { key: 'filesystem', label: 'Filesystem', icon: FolderOpen, target: 'filesystem' },
  { key: 'process', label: 'Process', icon: Cpu, target: 'process' },
] as const;

const MAX_PREVIEW_CHIPS = 5;

function getPreviewChips(policies: PolicyConfig[]): Array<{ label: string; action: string }> {
  const chips: Array<{ label: string; action: string }> = [];
  for (const p of policies) {
    for (const pattern of p.patterns) {
      chips.push({ label: pattern, action: p.action });
      if (chips.length >= MAX_PREVIEW_CHIPS) return chips;
    }
  }
  return chips;
}

export function PolicyOverview({ embedded }: PolicyOverviewProps) {
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: tiered } = useTieredPolicies();

  // Merge all tiers for counts and previews
  const allPolicies = useMemo(() => {
    if (!tiered) return [];
    return [...(tiered.managed ?? []), ...(tiered.global ?? []), ...(tiered.target ?? [])];
  }, [tiered]);

  const sectionData = useMemo(() => {
    return SECTIONS.map((s) => {
      const filtered = allPolicies.filter((p) => p.target === s.target);
      return {
        ...s,
        count: filtered.length,
        chips: getPreviewChips(filtered),
      };
    });
  }, [allPolicies]);

  const handleNavigate = (key: string) => {
    navigate(`/policies/${key}`, { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {sectionData.map((section) => {
        const Icon = section.icon;
        return (
          <SectionCard key={section.key} onClick={() => handleNavigate(section.key)}>
            <SectionHeader>
              <SectionTitle>
                <Icon size={18} color={theme.palette.text.secondary} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {section.label}
                </Typography>
              </SectionTitle>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {section.count} {section.count === 1 ? 'policy' : 'policies'}
                </Typography>
                <ChevronRight size={16} color={theme.palette.text.secondary} />
              </Box>
            </SectionHeader>
            {section.chips.length > 0 ? (
              <ChipRow>
                {section.chips.map((chip, i) => (
                  <Chip
                    key={i}
                    label={chip.label}
                    size="small"
                    variant="outlined"
                    sx={{
                      fontSize: 12,
                      borderColor: chip.action === 'deny'
                        ? theme.palette.error.main
                        : chip.action === 'allow'
                          ? theme.palette.success.main
                          : theme.palette.divider,
                      color: chip.action === 'deny'
                        ? theme.palette.error.main
                        : chip.action === 'allow'
                          ? theme.palette.success.main
                          : theme.palette.text.secondary,
                    }}
                  />
                ))}
                {allPolicies.filter((p) => p.target === section.target).length > MAX_PREVIEW_CHIPS && (
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 0.5 }}>
                    +{allPolicies.filter((p) => p.target === section.target).flatMap(p => p.patterns).length - MAX_PREVIEW_CHIPS} more
                  </Typography>
                )}
              </ChipRow>
            ) : (
              <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                No policies configured
              </Typography>
            )}
          </SectionCard>
        );
      })}

      {/* Policy Graph section */}
      <PolicyGraphPreview onNavigate={() => handleNavigate('graph')} />
    </Box>
  );
}

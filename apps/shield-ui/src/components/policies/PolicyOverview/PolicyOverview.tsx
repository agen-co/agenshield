/**
 * PolicyOverview — card-based summary of all policy types.
 *
 * Each policy type renders as a card with description and stats.
 * Clicking navigates to the drill-down view via onNavigate callback
 * (when embedded) or router navigation (standalone page).
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Chip } from '@mui/material';
import { Terminal, Globe, FolderOpen, Cpu, GitBranch, Play, ChevronRight } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { PolicyConfig } from '@agenshield/ipc';
import { useSnapshot } from 'valtio';
import { useTieredPolicies, usePolicyGraph } from '../../../api/hooks';
import { scopeStore } from '../../../state/scope';
import {
  CardGrid,
  TypeCard,
  CardHeader,
  CardTitleGroup,
  StatsRow,
  SecondaryRow,
  SecondaryCard,
} from './PolicyOverview.styles';
import type { PolicyOverviewProps, SectionCounts } from './PolicyOverview.types';

const SECTIONS = [
  {
    key: 'commands',
    label: 'Commands',
    icon: Terminal,
    target: 'command',
    description: 'Control which CLI commands agents can execute. Define allow/deny rules with glob patterns.',
  },
  {
    key: 'network',
    label: 'Network',
    icon: Globe,
    target: 'url',
    description: 'Control which URLs and endpoints agents can access, with HTTP method filtering.',
  },
  {
    key: 'filesystem',
    label: 'Filesystem',
    icon: FolderOpen,
    target: 'filesystem',
    description: 'Control read and write access to file system paths with directory-level granularity.',
  },
  {
    key: 'process',
    label: 'Process',
    icon: Cpu,
    target: 'process',
    description: 'Control process execution with configurable enforcement modes.',
  },
] as const;

function countByAction(policies: PolicyConfig[]): SectionCounts {
  let allow = 0;
  let deny = 0;
  let disabled = 0;
  for (const p of policies) {
    if (p.enabled === false) {
      disabled++;
    } else if (p.action === 'allow') {
      allow++;
    } else if (p.action === 'deny') {
      deny++;
    }
  }
  return { allow, deny, disabled, total: policies.length };
}

export function PolicyOverview({ embedded, onNavigate }: PolicyOverviewProps) {
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: tiered } = useTieredPolicies();
  const { data: graph } = usePolicyGraph();
  const { profileId } = useSnapshot(scopeStore);
  const isScoped = !!profileId;

  const allPolicies = useMemo(() => {
    if (!tiered) return [];
    return [...(tiered.managed ?? []), ...(tiered.global ?? []), ...(tiered.target ?? [])];
  }, [tiered]);

  const sectionData = useMemo(() => {
    return SECTIONS.map((s) => {
      const filtered = allPolicies.filter((p) => p.target === s.target);
      return { ...s, counts: countByAction(filtered) };
    });
  }, [allPolicies]);

  const nodeCount = graph?.nodes?.length ?? 0;
  const edgeCount = graph?.edges?.length ?? 0;

  const handleClick = (key: string) => {
    if (onNavigate) {
      onNavigate(key);
    } else {
      navigate(`/policies/${key}`);
    }
  };

  let delayIndex = 0;

  return (
    <>
      <CardGrid>
        {sectionData.map((section) => {
          const Icon = section.icon;
          const { allow, deny, disabled, total } = section.counts;
          const delay = delayIndex++ * 60;
          return (
            <TypeCard key={section.key} $delay={delay} onClick={() => handleClick(section.key)}>
              <CardHeader>
                <CardTitleGroup>
                  <Icon size={20} color={theme.palette.text.secondary} />
                  <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 16 }}>
                    {section.label}
                  </Typography>
                </CardTitleGroup>
                <ChevronRight size={16} color={theme.palette.text.disabled} />
              </CardHeader>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5 }}>
                {section.description}
              </Typography>

              <StatsRow>
                {total > 0 ? (
                  <>
                    <Chip
                      label={`${total} total`}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 11, height: 20 }}
                    />
                    {allow > 0 && (
                      <Chip
                        label={`${allow} allow`}
                        size="small"
                        sx={{
                          fontSize: 11,
                          height: 20,
                          bgcolor: `${theme.palette.success.main}18`,
                          color: theme.palette.success.main,
                          border: 'none',
                        }}
                      />
                    )}
                    {deny > 0 && (
                      <Chip
                        label={`${deny} deny`}
                        size="small"
                        sx={{
                          fontSize: 11,
                          height: 20,
                          bgcolor: `${theme.palette.error.main}18`,
                          color: theme.palette.error.main,
                          border: 'none',
                        }}
                      />
                    )}
                    {disabled > 0 && (
                      <Chip
                        label={`${disabled} off`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 11, height: 20, opacity: 0.5 }}
                      />
                    )}
                  </>
                ) : (
                  <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                    No policies configured
                  </Typography>
                )}
              </StatsRow>
            </TypeCard>
          );
        })}
      </CardGrid>

      <SecondaryRow>
        {/* Policy Graph card */}
        <SecondaryCard $delay={delayIndex++ * 60} onClick={() => handleClick('graph')}>
          <CardHeader>
            <CardTitleGroup>
              <GitBranch size={20} color={theme.palette.text.secondary} />
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 16 }}>
                Policy Graph
              </Typography>
            </CardTitleGroup>
            <ChevronRight size={16} color={theme.palette.text.disabled} />
          </CardHeader>
          <StatsRow sx={{ mt: 1 }}>
            {nodeCount > 0 ? (
              <>
                <Chip
                  label={`${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: 11, height: 20 }}
                />
                <Chip
                  label={`${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: 11, height: 20 }}
                />
              </>
            ) : (
              <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                Visualize conditional policy chains
              </Typography>
            )}
          </StatsRow>
        </SecondaryCard>

        {/* Simulate card — only visible in scoped context */}
        {isScoped && (
          <SecondaryCard $delay={delayIndex++ * 60} onClick={() => handleClick('simulate')}>
            <CardHeader>
              <CardTitleGroup>
                <Play size={20} color={theme.palette.text.secondary} />
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 16 }}>
                  Simulate
                </Typography>
              </CardTitleGroup>
              <ChevronRight size={16} color={theme.palette.text.disabled} />
            </CardHeader>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Test policy evaluation against simulated requests
            </Typography>
          </SecondaryCard>
        )}
      </SecondaryRow>
    </>
  );
}

import { useState } from 'react';
import { Chip, Collapse, IconButton, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Lock, Link, Layers } from 'lucide-react';
import type { PolicyTierSectionProps } from './PolicyTierSection.types';
import { TierContainer, TierHeader, TierContent } from './PolicyTierSection.styles';

const TIER_ICON = {
  managed: Lock,
  global: Layers,
  target: Link,
} as const;

const TIER_CHIP_COLOR = {
  managed: 'warning',
  global: 'default',
  target: 'default',
} as const;

const TIER_CHIP_LABEL = {
  managed: 'Admin-enforced',
  global: 'Inherited',
  target: undefined,
} as const;

export function PolicyTierSection({
  tier,
  label,
  description,
  count,
  collapsible = false,
  defaultCollapsed = false,
  readOnly,
  children,
}: PolicyTierSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const Icon = TIER_ICON[tier];
  const chipLabel = TIER_CHIP_LABEL[tier];
  const chipColor = TIER_CHIP_COLOR[tier];

  return (
    <TierContainer $tier={tier}>
      <TierHeader
        $tier={tier}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        sx={collapsible ? { cursor: 'pointer' } : undefined}
      >
        {collapsible && (
          <IconButton size="small" sx={{ p: 0 }}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </IconButton>
        )}
        <Icon size={16} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Chip label={count} size="small" sx={{ height: 20, fontSize: 12 }} />
        {chipLabel && (
          <Chip
            label={chipLabel}
            size="small"
            color={chipColor as 'warning' | 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {readOnly && tier !== 'managed' && (
          <Chip
            label="Read-only"
            size="small"
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {description}
          </Typography>
        )}
      </TierHeader>
      {collapsible ? (
        <Collapse in={!collapsed}>
          <TierContent>{children}</TierContent>
        </Collapse>
      ) : (
        <TierContent>{children}</TierContent>
      )}
    </TierContainer>
  );
}

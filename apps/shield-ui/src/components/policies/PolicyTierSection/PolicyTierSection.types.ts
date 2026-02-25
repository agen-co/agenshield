import type { ReactNode } from 'react';
import type { PolicyTier } from '@agenshield/ipc';

export interface PolicyTierSectionProps {
  tier: PolicyTier;
  label: string;
  description?: string;
  count: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  readOnly?: boolean;
  children: ReactNode;
}

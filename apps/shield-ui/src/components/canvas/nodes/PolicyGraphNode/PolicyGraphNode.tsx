/**
 * PolicyGraphNode has been merged into ShieldCoreNode.
 * AgenShield IS the policy bus — no separate PolicyGraph node needed.
 * This file is kept as a stub for import compatibility.
 */

import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

export const PolicyGraphNode = memo((_props: NodeProps) => null);
PolicyGraphNode.displayName = 'PolicyGraphNode';

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Wifi, Lock, Bell, Activity, Cloud } from 'lucide-react';
import { HudWrapper, HudIconBox, StatusDot, getStatusColor, HudLabel, HudValue } from './HudIndicatorNode.styles';
import type { HudIndicatorData } from '../../Canvas.types';

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  connectivity: Wifi,
  auth: Lock,
  alerts: Bell,
  throughput: Activity,
  cloud: Cloud,
};

export const HudIndicatorNode = memo(({ data }: NodeProps) => {
  const { type, label, status, value } = data as unknown as HudIndicatorData;
  const IconComp = iconMap[type] ?? Activity;
  const color = getStatusColor(status);

  return (
    <HudWrapper>
      <HudIconBox>
        <IconComp size={16} color={color} />
        <StatusDot $status={status} style={{ backgroundColor: color }} />
      </HudIconBox>
      <HudLabel>{label}</HudLabel>
      {value !== undefined && <HudValue>{value}</HudValue>}
    </HudWrapper>
  );
});
HudIndicatorNode.displayName = 'HudIndicatorNode';

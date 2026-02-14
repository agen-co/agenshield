import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { PolicyGraphWrapper, PolicyGraphLabel, PolicyGraphSub } from './PolicyGraphNode.styles';
import type { PolicyGraphData } from '../../Canvas.types';

export const PolicyGraphNode = memo(({ data }: NodeProps) => {
  const { activePolicies, targetCount } = data as unknown as PolicyGraphData;
  const active = activePolicies > 0;
  const iconColor = active ? '#6BAEF2' : '#808080';
  const topHandleCount = Math.max(targetCount, 1);

  return (
    <PolicyGraphWrapper $active={active}>
      {/* Top handles — one per target */}
      {Array.from({ length: topHandleCount }, (_, i) => (
        <Handle
          key={`top-${i}`}
          type="target"
          position={Position.Top}
          id={`top-${i}`}
          style={{ left: `${((i + 1) / (topHandleCount + 1)) * 100}%`, visibility: 'hidden' }}
        />
      ))}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <GitBranch size={20} color={iconColor} />
      </div>
      <div>
        <PolicyGraphLabel>Policy Engine</PolicyGraphLabel>
        <PolicyGraphSub>
          {activePolicies} active {activePolicies === 1 ? 'policy' : 'policies'}
        </PolicyGraphSub>
      </div>
      {/* Bottom handles — one per firewall piece (always 3) */}
      {[0, 1, 2].map((i) => (
        <Handle
          key={`bottom-${i}`}
          type="source"
          position={Position.Bottom}
          id={`bottom-${i}`}
          style={{ left: `${((i + 1) / 4) * 100}%`, visibility: 'hidden' }}
        />
      ))}
      <Handle type="source" position={Position.Left} id="bottom-left" style={{ visibility: 'hidden' }} />
    </PolicyGraphWrapper>
  );
});
PolicyGraphNode.displayName = 'PolicyGraphNode';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ShieldBan } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { dotAnimationStore } from '../../state/dotAnimations';
import { BucketWrapper, BucketLabel, CountBadge } from './DeniedBucketNode.styles';

export const DeniedBucketNode = memo((_props: NodeProps) => {
  const { deniedCount } = useSnapshot(dotAnimationStore);

  return (
    <BucketWrapper>
      <Handle type="target" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <ShieldBan size={18} color="#E1583E" />
      </div>
      <BucketLabel>Denied</BucketLabel>
      {deniedCount > 0 && <CountBadge>{deniedCount}</CountBadge>}
    </BucketWrapper>
  );
});
DeniedBucketNode.displayName = 'DeniedBucketNode';

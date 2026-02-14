import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { Globe, Play, Square, RotateCcw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { canvasStore } from '../../state/canvas';
import {
  TargetWrapper, TargetLabel, TargetSub, TargetUsers,
  UserChip, ActionRow, ActionBtn,
} from './TargetNode.styles';
import type { TargetNodeData } from '../../Canvas.types';

export const TargetNode = memo(({ data }: NodeProps) => {
  const { target } = data as unknown as TargetNodeData;
  const { pulses } = useSnapshot(canvasStore);
  const pulse = pulses[target.id];

  const uptime = target.createdAt
    ? formatDistanceToNow(target.createdAt)
    : undefined;

  return (
    <TargetWrapper $shielded={target.shielded} $pulseSeverity={pulse?.severity}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', paddingTop: 2 }}>
        <Globe size={18} color={target.shielded ? '#6CB685' : '#E1583E'} />
      </div>
      <div>
        <TargetLabel>{target.name}</TargetLabel>
        <TargetSub>
          {target.type}
          {target.pid ? ` · PID ${target.pid}` : ''}
          {uptime ? ` · ${uptime}` : ''}
        </TargetSub>
        {target.users.length > 0 && (
          <TargetUsers>
            {target.users.map((u) => (
              <UserChip key={u}>{u}</UserChip>
            ))}
          </TargetUsers>
        )}
        <ActionRow>
          <ActionBtn title="Start"><Play size={12} /></ActionBtn>
          <ActionBtn title="Stop"><Square size={12} /></ActionBtn>
          <ActionBtn title="Restart"><RotateCcw size={12} /></ActionBtn>
        </ActionRow>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </TargetWrapper>
  );
});
TargetNode.displayName = 'TargetNode';

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Shield } from 'lucide-react';
import { LogoWrapper, LogoText, LogoStatusChip, LogoSub } from './LogoNode.styles';
import type { LogoNodeData } from '../../Canvas.types';

export const LogoNode = memo(({ data }: NodeProps) => {
  const { running, pid, version } = data as unknown as LogoNodeData;

  return (
    <LogoWrapper>
      <Shield size={22} />
      <div>
        <LogoText>AgenShield</LogoText>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <LogoStatusChip $running={running}>
            {running ? 'Running' : 'Stopped'}
          </LogoStatusChip>
          <LogoSub>
            v{version}
            {pid ? ` · PID ${pid}` : ''}
          </LogoSub>
        </div>
      </div>
    </LogoWrapper>
  );
});
LogoNode.displayName = 'LogoNode';

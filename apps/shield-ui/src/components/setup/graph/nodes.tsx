/**
 * Custom ReactFlow node types for the security architecture graph
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { styled } from '@mui/material/styles';
import {
  Shield, User, Folder, Server, Skull, Key, Terminal,
  Globe, Lock, FileCode, Wifi, BrickWall, ScrollText,
} from 'lucide-react';
import { nodeAppear, buildingPulse, securedGlow, attackPulse } from '../../../styles/setup-animations';

// --- Styled components ---

type NodeStatus = 'vulnerable' | 'building' | 'secured' | undefined;

const NodeWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== 'nodeStatus',
})<{ nodeStatus?: NodeStatus }>(({ nodeStatus }) => ({
  padding: '12px 16px',
  borderRadius: 10,
  border: '2px solid',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: "'Manrope', sans-serif",
  fontSize: 13,
  minWidth: 140,
  position: 'relative' as const,
  animation: `${nodeAppear} 0.4s ease-out forwards`,
  // Default (neutral)
  borderColor: '#6b7280',
  background: 'rgba(107, 114, 128, 0.08)',
  color: '#d1d5db',
  ...(nodeStatus === 'vulnerable' && {
    borderColor: '#ef4444',
    background: 'rgba(239, 68, 68, 0.08)',
    color: '#fca5a5',
    animation: `${nodeAppear} 0.4s ease-out forwards, ${attackPulse} 2s ease-in-out infinite`,
  }),
  ...(nodeStatus === 'building' && {
    borderColor: 'rgba(59, 130, 246, 0.6)',
    background: 'rgba(59, 130, 246, 0.08)',
    color: '#93c5fd',
    animation: `${nodeAppear} 0.4s ease-out forwards, ${buildingPulse} 1.5s ease-in-out infinite`,
  }),
  ...(nodeStatus === 'secured' && {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.08)',
    color: '#86efac',
    animation: `${nodeAppear} 0.4s ease-out forwards, ${securedGlow} 3s ease-in-out infinite`,
  }),
}));

const IconWrap = styled('div')({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
});

const Label = styled('div')({
  fontWeight: 600,
  lineHeight: 1.3,
});

const SubLabel = styled('div')({
  fontSize: 11,
  opacity: 0.7,
  fontFamily: "'IBM Plex Mono', monospace",
});

// --- Node types ---

/** Target application node (e.g. OpenClaw) */
export const TargetNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <IconWrap><Globe size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.version && <SubLabel>v{data.version as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
TargetNode.displayName = 'TargetNode';

/** Access node (Root, Bash shell) */
export const AccessNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><Key size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.sublabel && <SubLabel>{data.sublabel as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
AccessNode.displayName = 'AccessNode';

/** User node (agent user, broker user) */
export const UserNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><User size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.username && <SubLabel>{data.username as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
UserNode.displayName = 'UserNode';

/** Workspace directory node */
export const WorkspaceNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><Folder size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.path && <SubLabel>{data.path as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
WorkspaceNode.displayName = 'WorkspaceNode';

/** Security node (seatbelt, wrappers, policies) */
export const SecurityNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><Shield size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.badge && <SubLabel>{data.badge as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
SecurityNode.displayName = 'SecurityNode';

/** Broker node (central policy guard) */
export const BrokerNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><Lock size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.sublabel && <SubLabel>{data.sublabel as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
BrokerNode.displayName = 'BrokerNode';

/** Daemon node (root daemon monitor) */
export const DaemonNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <IconWrap><Server size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.running && <SubLabel>Running</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
DaemonNode.displayName = 'DaemonNode';

/** Attack vector node (threat endpoints) */
export const AttackNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.blocked ? undefined : 'vulnerable'} style={{ minWidth: 200, ...(data.dimmed ? { opacity: 0.2 } : {}) }}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap>
      {data.blocked ? <FileCode size={18} /> : <Skull size={18} />}
    </IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.command && <SubLabel>{data.command as string}</SubLabel>}
      {!!data.blocked && (
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>BLOCKED</div>
      )}
    </div>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
AttackNode.displayName = 'AttackNode';

/** Shell node (Bash) */
export const ShellNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><Terminal size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
ShellNode.displayName = 'ShellNode';

/** Socket node */
export const SocketNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <IconWrap><Wifi size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.path && <SubLabel>{data.path as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
SocketNode.displayName = 'SocketNode';

/** AgenShield container — green rounded box wrapping protected nodes */
const ContainerBox = styled('div', {
  shouldForwardProp: (prop) => prop !== 'nodeStatus',
})<{ nodeStatus?: NodeStatus }>(({ nodeStatus }) => ({
  width: '100%',
  height: '100%',
  borderRadius: 16,
  border: '2px solid',
  position: 'relative',
  animation: `${nodeAppear} 0.5s ease-out forwards`,
  borderColor: '#6b7280',
  background: 'rgba(107, 114, 128, 0.04)',
  ...(nodeStatus === 'building' && {
    borderColor: 'rgba(59, 130, 246, 0.5)',
    background: 'rgba(59, 130, 246, 0.03)',
    animation: `${nodeAppear} 0.5s ease-out forwards, ${buildingPulse} 2s ease-in-out infinite`,
  }),
  ...(nodeStatus === 'secured' && {
    borderColor: 'rgba(34, 197, 94, 0.6)',
    background: 'rgba(34, 197, 94, 0.03)',
    animation: `${nodeAppear} 0.5s ease-out forwards, ${securedGlow} 3s ease-in-out infinite`,
  }),
}));

const ContainerLabel = styled('div', {
  shouldForwardProp: (prop) => prop !== 'nodeStatus',
})<{ nodeStatus?: NodeStatus }>(({ nodeStatus }) => ({
  position: 'absolute',
  top: 10,
  left: 14,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: "'Manrope', sans-serif",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
  color: '#6b7280',
  ...(nodeStatus === 'building' && { color: '#93c5fd' }),
  ...(nodeStatus === 'secured' && { color: '#86efac' }),
}));

export const ContainerNode = memo(({ data }: NodeProps) => (
  <ContainerBox nodeStatus={data.status as NodeStatus}>
    <ContainerLabel nodeStatus={data.status as NodeStatus}>
      <Shield size={14} />
      {data.label as string}
    </ContainerLabel>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </ContainerBox>
));
ContainerNode.displayName = 'ContainerNode';

/** Firewall node */
export const FirewallNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><BrickWall size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.sublabel && <SubLabel>{data.sublabel as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
FirewallNode.displayName = 'FirewallNode';

/** Audit log node */
export const AuditLogNode = memo(({ data }: NodeProps) => (
  <NodeWrapper nodeStatus={data.status as NodeStatus}>
    <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
    <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    <IconWrap><ScrollText size={20} /></IconWrap>
    <div>
      <Label>{data.label as string}</Label>
      {!!data.sublabel && <SubLabel>{data.sublabel as string}</SubLabel>}
    </div>
    <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
  </NodeWrapper>
));
AuditLogNode.displayName = 'AuditLogNode';

// --- Node type registry ---

export const nodeTypes = {
  target: TargetNode,
  access: AccessNode,
  user: UserNode,
  workspace: WorkspaceNode,
  security: SecurityNode,
  broker: BrokerNode,
  daemon: DaemonNode,
  attack: AttackNode,
  shell: ShellNode,
  socket: SocketNode,
  container: ContainerNode,
  firewall: FirewallNode,
  auditlog: AuditLogNode,
};

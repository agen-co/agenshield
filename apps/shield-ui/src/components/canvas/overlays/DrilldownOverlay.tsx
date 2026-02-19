/**
 * DrilldownOverlay — floating panel showing detail for a drilled-into card or system component.
 *
 * Card drilldown: Shows card name, type, version, MCP servers, and skills.
 * Component drilldown: Shows component-specific content.
 *   - logs: Renders a recent activity/event table from eventStore
 *   - Others: Summary card (label, status)
 */

import { memo, useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { ArrowLeft, Server, Wrench, Circle, Activity, Cpu, Network, Terminal, HardDrive, MemoryStick, Eye, FileText, KeyRound, Scale } from 'lucide-react';
import { drilldownStore, closeDrilldown } from '../../../state/canvas-drilldown';
import { eventStore } from '../../../state/events';
import type { ApplicationCardData, SystemComponentType } from '../Canvas.types';

interface DrilldownOverlayProps {
  cards: ApplicationCardData[];
}

const COMPONENT_META: Record<SystemComponentType, { label: string; icon: typeof Cpu; description: string }> = {
  cpu: { label: 'CPU / Process', icon: Cpu, description: 'Process execution monitoring' },
  network: { label: 'Network', icon: Network, description: 'Network traffic inspection' },
  command: { label: 'Command Exec', icon: Terminal, description: 'Shell command interception' },
  filesystem: { label: 'Filesystem', icon: HardDrive, description: 'File system access control' },
  memory: { label: 'Memory', icon: MemoryStick, description: 'Memory usage tracking' },
  monitoring: { label: 'Monitor', icon: Eye, description: 'System monitoring & metrics' },
  logs: { label: 'Logs', icon: FileText, description: 'Event log & activity stream' },
  secrets: { label: 'Secrets', icon: KeyRound, description: 'Secret vault management' },
  'policy-graph': { label: 'Policy Graph', icon: Scale, description: 'Active policy rule engine' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Component-specific drilldown content */
const ComponentDrilldown = memo(({ componentType }: { componentType: SystemComponentType }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const textPrimary = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  const meta = COMPONENT_META[componentType];
  const Icon = meta.icon;

  const handleClose = useCallback(() => {
    closeDrilldown();
  }, []);

  if (componentType === 'logs') {
    return <LogsDrilldown onClose={handleClose} />;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${borderColor}`,
            backgroundColor: 'transparent', color: textSecondary,
            cursor: 'pointer', padding: 0,
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <Icon size={18} color={textPrimary} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: textSecondary }}>{meta.description}</div>
        </div>
      </div>

      {/* Summary */}
      <div style={{
        padding: '10px 12px',
        borderRadius: 6,
        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
        fontSize: 12,
        fontFamily: "'IBM Plex Mono', monospace",
        color: textSecondary,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Circle size={6} fill="#6CB685" color="transparent" />
          <span style={{ color: textPrimary, fontWeight: 600 }}>Active</span>
        </div>
        <div style={{ fontSize: 11, paddingLeft: 12 }}>
          Component is online and being monitored by AgenShield.
        </div>
      </div>
    </div>
  );
});
ComponentDrilldown.displayName = 'ComponentDrilldown';

/** Logs-specific drilldown: activity/event table */
const LogsDrilldown = memo(({ onClose }: { onClose: () => void }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const textPrimary = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const { events } = useSnapshot(eventStore);

  const recentEvents = events.slice(0, 30);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6,
            border: `1px solid ${borderColor}`,
            backgroundColor: 'transparent', color: textSecondary,
            cursor: 'pointer', padding: 0,
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <Activity size={18} color={textPrimary} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Activity Log</div>
          <div style={{ fontSize: 11, color: textSecondary }}>
            {events.length} total events
          </div>
        </div>
      </div>

      {/* Event table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '70px 1fr 60px',
          gap: 6,
          padding: '4px 8px',
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: textSecondary,
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <span>Time</span>
          <span>Event</span>
          <span>Status</span>
        </div>

        {recentEvents.length === 0 ? (
          <div style={{
            padding: '12px 8px',
            fontSize: 12,
            color: textSecondary,
            fontStyle: 'italic',
            textAlign: 'center',
          }}>
            No events yet
          </div>
        ) : (
          recentEvents.map((evt, idx) => {
            const isError = String(evt.type).includes('denied') || String(evt.type).includes('error');
            const isWarning = String(evt.type).includes('warn');
            const statusColor = isError ? '#E1583E' : isWarning ? '#EEA45F' : '#6CB685';
            const statusLabel = isError ? 'DENY' : isWarning ? 'WARN' : 'OK';

            return (
              <div
                key={`${evt.id}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1fr 60px',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 3,
                  backgroundColor: idx % 2 === 0
                    ? (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)')
                    : 'transparent',
                  fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                  alignItems: 'center',
                }}
              >
                <span style={{ color: textSecondary, fontSize: 9 }}>
                  {formatTime(evt.timestamp)}
                </span>
                <span style={{
                  color: textPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {String(evt.type).replace(/^(api|security|core|exec|wrapper)\./, '')}
                </span>
                <span style={{ color: statusColor, fontSize: 9, fontWeight: 600 }}>
                  {statusLabel}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
LogsDrilldown.displayName = 'LogsDrilldown';

export const DrilldownOverlay = memo(({ cards }: DrilldownOverlayProps) => {
  const { activeCardId } = useSnapshot(drilldownStore);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleClose = useCallback(() => {
    closeDrilldown();
  }, []);

  const bgColor = isDark ? 'rgba(22,22,26,0.95)' : 'rgba(248,248,246,0.95)';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const textPrimary = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;

  // Card drilldown
  if (!activeCardId) return null;

  const card = cards.find((c) => c.id === activeCardId);
  if (!card) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        zIndex: 10,
        width: 320,
        maxHeight: 'calc(100vh - 40px)',
        overflow: 'auto',
        backgroundColor: bgColor,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: 20,
        fontFamily: "'Manrope', sans-serif",
        color: textPrimary,
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${borderColor}`,
            backgroundColor: 'transparent',
            color: textSecondary,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{card.name}</div>
          <div style={{ fontSize: 11, color: textSecondary }}>
            {card.type}{card.version ? ` v${card.version}` : ''}
          </div>
        </div>
      </div>

      {/* Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 16,
        padding: '6px 10px',
        borderRadius: 6,
        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
      }}>
        <Circle
          size={8}
          fill={card.status === 'shielded' ? '#6CB685' : card.status === 'shielding' ? '#EEA45F' : '#E1583E'}
          color="transparent"
        />
        {card.status.toUpperCase()}
        {card.isRunning !== undefined && (
          <span style={{ marginLeft: 'auto', color: textSecondary }}>
            {card.isRunning ? 'RUNNING' : 'STOPPED'}
          </span>
        )}
      </div>

      {/* MCP Servers */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: textSecondary,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <Server size={12} />
          MCP Servers
        </div>
        {(card.mcpServers ?? []).length === 0 ? (
          <div style={{ fontSize: 12, color: textSecondary, fontStyle: 'italic', paddingLeft: 18 }}>
            No MCP servers connected
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {card.mcpServers!.map((mcp) => (
              <div key={mcp.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                borderRadius: 4,
                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                fontSize: 12,
              }}>
                <Circle
                  size={6}
                  fill={mcp.active ? '#6CB685' : '#888'}
                  color="transparent"
                />
                {mcp.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skills */}
      <div>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: textSecondary,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <Wrench size={12} />
          Skills
        </div>
        {(card.skills ?? []).length === 0 ? (
          <div style={{ fontSize: 12, color: textSecondary, fontStyle: 'italic', paddingLeft: 18 }}>
            No skills connected
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {card.skills!.map((skill) => (
              <div key={skill.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                borderRadius: 4,
                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                fontSize: 12,
              }}>
                <Circle
                  size={6}
                  fill={skill.active ? '#6CB685' : '#888'}
                  color="transparent"
                />
                {skill.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
DrilldownOverlay.displayName = 'DrilldownOverlay';

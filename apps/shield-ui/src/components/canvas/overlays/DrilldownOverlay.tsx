/**
 * DrilldownOverlay — floating panel showing MCP/skill hierarchy for a drilled-into card.
 *
 * Displays when drilldownStore.activeCardId is set. Shows card name, type, version,
 * connected MCP servers, and connected skills. Includes a back button to return to full view.
 */

import { memo, useCallback } from 'react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { ArrowLeft, Server, Wrench, Circle } from 'lucide-react';
import { drilldownStore, closeDrilldown } from '../../../state/canvas-drilldown';
import type { ApplicationCardData } from '../Canvas.types';

interface DrilldownOverlayProps {
  cards: ApplicationCardData[];
}

export const DrilldownOverlay = memo(({ cards }: DrilldownOverlayProps) => {
  const { activeCardId } = useSnapshot(drilldownStore);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleClose = useCallback(() => {
    closeDrilldown();
  }, []);

  if (!activeCardId) return null;

  const card = cards.find((c) => c.id === activeCardId);
  if (!card) return null;

  const bgColor = isDark ? 'rgba(22,22,26,0.95)' : 'rgba(248,248,246,0.95)';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const textPrimary = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;

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

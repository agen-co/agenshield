/**
 * MetricsClusterNode — motherboard-style node with 4 sub-PCBs.
 *
 * Each sub-PCB has a distinct accent color, top accent bar, chip marking,
 * LED indicator, and mini pin row. The outer board has mounting holes
 * and connecting SVG traces.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import { systemStore } from '../../../../state/system-store';
import type { HandleSpec } from '../../Canvas.types';

function getLedColor(value: number): string {
  if (value >= 95) return pcb.component.ledRed;
  if (value >= 80) return pcb.component.ledAmber;
  return pcb.component.ledGreen;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/* ---- Layout constants ---- */
const SUB_W = 140;
const SUB_H = 72;
const GAP = 8;
const PADDING = 12;
const INFO_BAR_H = 14;
const LABEL_H = 20;
const CLUSTER_W = SUB_W * 4 + GAP * 3 + PADDING * 2;
const CLUSTER_H = SUB_H + PADDING * 2 + LABEL_H + INFO_BAR_H + 4;

/* ---- Sub-PCB component ---- */

interface SubPcbProps {
  label: string;
  value: string;
  chipId: string;
  ledColor: string;
  isDark: boolean;
  percent?: number;
}

function SubPcb({ label, value, chipId, ledColor, isDark, percent }: SubPcbProps) {
  const bg = isDark ? pcb.component.body : pcb.light.body;
  const textColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const dimColor = isDark ? pcb.silk.dim : pcb.light.silkDim;
  const pinColor = isDark ? pcb.component.pin : pcb.light.trace;
  const borderColor = isDark ? 'rgba(160,160,168,0.15)' : 'rgba(80,80,80,0.15)';

  return (
    <div style={{
      width: SUB_W,
      height: SUB_H,
      background: bg,
      borderRadius: 4,
      border: `0.6px solid ${borderColor}`,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: dimColor,
        opacity: 0.3,
      }} />

      {/* Faint trace pattern overlay */}
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.04, pointerEvents: 'none' }}
        viewBox={`0 0 ${SUB_W} ${SUB_H}`}
      >
        <line x1="10" y1="15" x2="60" y2="15" stroke={dimColor} strokeWidth="0.5" />
        <line x1="60" y1="15" x2="60" y2="35" stroke={dimColor} strokeWidth="0.5" />
        <line x1="80" y1="10" x2="130" y2="10" stroke={dimColor} strokeWidth="0.5" />
        <line x1="80" y1="10" x2="80" y2="45" stroke={dimColor} strokeWidth="0.5" />
        <line x1="20" y1="45" x2="100" y2="45" stroke={dimColor} strokeWidth="0.5" />
      </svg>

      {/* Chip marking */}
      <span style={{
        position: 'absolute',
        top: 6,
        left: 6,
        fontSize: 7,
        fontFamily: "'IBM Plex Mono', monospace",
        color: dimColor,
        opacity: 0.5,
      }}>
        {chipId}
      </span>

      {/* LED indicator */}
      <div style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: ledColor,
        boxShadow: `0 0 4px ${ledColor}`,
      }} />

      {/* Content */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: SUB_H - 14, // leave room for pin row
        paddingTop: 6,
        gap: 2,
      }}>
        <span style={{
          fontSize: 9,
          fontFamily: "'IBM Plex Mono', monospace",
          color: textColor,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontWeight: 600,
          opacity: 0.9,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 13,
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 600,
          color: textColor,
        }}>
          {value}
        </span>
        {percent != null && (
          <div style={{
            width: '60%', height: 3, borderRadius: 1.5,
            background: dimColor, opacity: 0.15,
            position: 'relative', margin: '0 auto',
          }}>
            <div style={{
              width: `${percent}%`, height: '100%',
              background: getLedColor(percent),
              borderRadius: 1.5, opacity: 0.6,
            }} />
          </div>
        )}
      </div>

      {/* Mini pin row along bottom */}
      <div style={{
        position: 'absolute',
        bottom: 3,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
      }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: 1,
              background: pinColor,
              opacity: 0.4,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---- Mounting hole ---- */

function MountingHole({ isDark }: { isDark: boolean }) {
  const ringColor = isDark ? pcb.via.ring : pcb.light.trace;
  return (
    <div style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      border: `1.5px solid ${ringColor}`,
      background: 'transparent',
      opacity: 0.5,
    }} />
  );
}

/* ---- Main component ---- */

export const MetricsClusterNode = memo((props: NodeProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const snap = useSnapshot(systemStore);
  const m = snap.metrics;
  const loaded = snap.metricsLoaded;
  const sysInfo = snap.systemInfo;

  const boardBg = isDark ? pcb.board.base : pcb.light.base;
  const silkColor = isDark ? pcb.silk.dim : pcb.light.silkDim;
  const traceColor = isDark ? pcb.board.traceFaint : pcb.light.trace;

  const handleOverrides = (props.data as Record<string, unknown>)?.handleOverrides as HandleSpec[] | undefined;

  return (
    <div style={{
      width: CLUSTER_W,
      height: CLUSTER_H,
      background: boardBg,
      border: `1px solid ${isDark ? 'rgba(160,160,168,0.2)' : 'rgba(0,0,0,0.12)'}`,
      borderRadius: 6,
      padding: PADDING,
      cursor: 'pointer',
      position: 'relative',
      opacity: loaded ? 1 : 0.4,
      transition: 'opacity 0.5s ease',
    }}>
      {/* Dynamic handles from pin allocator */}
      {handleOverrides ? handleOverrides.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type={h.type}
          position={h.position}
          style={{
            visibility: 'hidden',
            ...(h.offset != null
              ? h.position === Position.Top || h.position === Position.Bottom
                ? { left: h.offset, ...(h.position === Position.Top ? { top: 0 } : { bottom: 0 }) }
                : { top: h.offset, ...(h.position === Position.Left ? { left: 0 } : { right: 0 }) }
              : {}),
          }}
        />
      )) : (
        <>
          <Handle type="target" position={Position.Top} id="top-in" style={{ visibility: 'hidden' }} />
          <Handle type="source" position={Position.Bottom} id="bottom-out" style={{ visibility: 'hidden' }} />
        </>
      )}

      {/* Corner mounting holes */}
      <div style={{ position: 'absolute', top: 4, left: 4 }}><MountingHole isDark={isDark} /></div>
      <div style={{ position: 'absolute', top: 4, right: 4 }}><MountingHole isDark={isDark} /></div>
      <div style={{ position: 'absolute', bottom: 4, left: 4 }}><MountingHole isDark={isDark} /></div>
      <div style={{ position: 'absolute', bottom: 4, right: 4 }}><MountingHole isDark={isDark} /></div>

      {/* Connecting trace lines between sub-PCBs */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 0.3,
        }}
        viewBox={`0 0 ${CLUSTER_W} ${CLUSTER_H}`}
      >
        {/* Horizontal traces connecting sub-PCBs */}
        {[0, 1, 2].map((i) => {
          const x1 = PADDING + SUB_W * (i + 1) + GAP * i - 2;
          const x2 = PADDING + SUB_W * (i + 1) + GAP * (i + 1) + 2;
          const y = PADDING + LABEL_H + INFO_BAR_H + SUB_H / 2;
          return (
            <line
              key={`h-trace-${i}`}
              x1={x1} y1={y}
              x2={x2} y2={y}
              stroke={traceColor}
              strokeWidth="1"
              strokeDasharray="3 2"
            />
          );
        })}
      </svg>

      {/* System info bar */}
      {sysInfo && (
        <div style={{
          fontSize: 8,
          fontFamily: "'IBM Plex Mono', monospace",
          color: silkColor,
          letterSpacing: 0.3,
          marginBottom: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {sysInfo.hostname} | {sysInfo.activeUser} | up {formatUptime(sysInfo.uptime)}
        </div>
      )}

      {/* Label */}
      <div style={{
        fontSize: 8,
        fontFamily: "'IBM Plex Mono', monospace",
        color: silkColor,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 6,
      }}>
        SYSTEM METRICS
      </div>

      {/* Sub-PCBs row */}
      <div style={{ display: 'flex', gap: GAP, position: 'relative' }}>
        <SubPcb
          label="CPU"
          value={loaded ? `${Math.round(m.cpuPercent)}%` : '--'}
          percent={loaded ? m.cpuPercent : undefined}
          chipId="U1"
          ledColor={loaded ? getLedColor(m.cpuPercent) : pcb.component.ledGreen}
          isDark={isDark}
        />
        <SubPcb
          label="NETWORK"
          value={loaded ? `↑${formatBytes(m.netUp)} ↓${formatBytes(m.netDown)}` : '--'}
          chipId="U2"
          ledColor={pcb.component.ledGreen}
          isDark={isDark}
        />
        <SubPcb
          label="DISK"
          value={loaded ? `${Math.round(m.diskPercent)}%` : '--'}
          percent={loaded ? m.diskPercent : undefined}
          chipId="U3"
          ledColor={loaded ? getLedColor(m.diskPercent) : pcb.component.ledGreen}
          isDark={isDark}
        />
        <SubPcb
          label="MEMORY"
          value={loaded ? `${Math.round(m.memPercent)}%` : '--'}
          percent={loaded ? m.memPercent : undefined}
          chipId="U4"
          ledColor={loaded ? getLedColor(m.memPercent) : pcb.component.ledGreen}
          isDark={isDark}
        />
      </div>
    </div>
  );
});
MetricsClusterNode.displayName = 'MetricsClusterNode';

/** Dimensions for layout */
export const METRICS_CLUSTER_DIMS = { w: CLUSTER_W, h: CLUSTER_H };

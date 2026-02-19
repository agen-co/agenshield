/**
 * SystemComponentNode — thin orchestrator for PCB component chips.
 *
 * Renders handles, memoized theme context, and delegates all rendering
 * to the variant Component. The orchestrator has ZERO valtio subscriptions —
 * only variant components subscribe to their own metrics & status.
 *
 * 7 variants: cpu, network, command, filesystem, memory, monitoring, logs.
 */

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import { VARIANTS } from './system.constants';
import { connectionPads, PIN_EXT_Y, PIN_EXT_X } from './primitives';
import type { SystemComponentData } from '../../Canvas.types';
import type { ThemeCtx } from './system.types';

export const SystemComponentNode = memo(({ data }: NodeProps) => {
  const {
    componentType, label, sublabel, handleOverrides,
  } = data as unknown as SystemComponentData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const variant = VARIANTS[componentType];
  if (!variant) return null;

  const { w, h, refDesignator, layout, Component } = variant;
  const handles = handleOverrides ?? variant.defaultHandles;

  // Compute bottom handle offsets for connection pads
  const bottomOffsets = handles
    .filter((s) => s.position === Position.Bottom)
    .map((s) => s.offset ?? w / 2);

  const themeCtx = useMemo<ThemeCtx>(() => ({
    isDark,
    chipBody:   isDark ? '#28292E' : '#D8D8D0',
    chipBorder: isDark ? 'rgba(140,140,140,0.35)' : 'rgba(80,80,80,0.2)',
    padColor:   pcb.component.padGold,
    pinColor:   pcb.component.pin,
    traceClr:   isDark ? pcb.trace.silver : '#888888',
    silkColor:  isDark ? '#FFFFFF' : pcb.light.silk,
    silkDim:    isDark ? '#B0B4B8' : '#6A6A5A',
  }), [isDark]);

  return (
    <div
      style={{
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      {handles.map((spec) => (
        <Handle key={spec.id} type={spec.type} position={spec.position} id={spec.id}
          style={{
            ...(spec.position === Position.Top || spec.position === Position.Bottom
              ? { left: (spec.offset ?? w / 2) + (spec.position === Position.Bottom ? PIN_EXT_X : 0) }
              : { top: spec.offset ?? h / 2 }),
            ...(spec.position === Position.Bottom ? { top: h + PIN_EXT_Y } : {}),
            ...(spec.position === Position.Right ? { left: w } : {}),
            visibility: 'hidden',
          }} />
      ))}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', overflow: 'visible' }}>
        <Component
          componentType={componentType}
          label={label}
          sublabel={sublabel}
          refDesignator={refDesignator}
          theme={themeCtx}
          layout={layout}
          w={w}
          h={h}
          bottomHandles={bottomOffsets.length > 0 ? bottomOffsets : undefined}
        />
        {bottomOffsets.length > 0 && connectionPads(bottomOffsets, layout.body.y + layout.body.h, themeCtx.padColor, themeCtx.pinColor)}
      </svg>
    </div>
  );
});
SystemComponentNode.displayName = 'SystemComponentNode';

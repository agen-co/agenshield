/**
 * VARIANTS registry — maps each SystemComponentType to its module metadata
 * (dimensions, layout, handles, and React component).
 *
 * Consumed by the orchestrator (SystemComponentNode) and by useSetupCanvasLayout
 * to eliminate duplicated w/h constants.
 */

import { Position } from '@xyflow/react';
import type { SystemComponentType } from '../../Canvas.types';
import type { VariantModule, HandleSpec } from './system.types';
import { CpuChip, NetworkChip, CommandChip, FilesystemChip, MemoryChip, MonitoringChip, LogsChip, SecretsChip, PolicyGraphChip } from './variants';

/**
 * Compute center pin pair from bottomGullPins formula (margin=12).
 * Even count → two center pins; odd count → center pin ± 3.
 */
function gullPinPair(bodyX: number, bodyW: number, count: number): [number, number] {
  const margin = 12;
  const spacing = (bodyW - margin * 2) / Math.max(count - 1, 1);
  const centerIdx = (count - 1) / 2;
  if (count % 2 === 0) {
    return [
      bodyX + margin + Math.floor(centerIdx) * spacing,
      bodyX + margin + Math.ceil(centerIdx) * spacing,
    ];
  }
  const center = bodyX + margin + centerIdx * spacing;
  return [center - 3, center + 3];
}

/** Compute center pin pair from edge connector pins (margin=8) */
function edgePinPair(bodyX: number, bodyW: number, count: number): [number, number] {
  const margin = 8;
  const spacing = (bodyW - margin * 2) / (count - 1);
  return [
    bodyX + margin + Math.floor((count - 1) / 2) * spacing,
    bodyX + margin + Math.ceil((count - 1) / 2) * spacing,
  ];
}

/** Compute center pin pair from memory finger pins (margin=6) */
function fingerPinPair(bodyX: number, bodyW: number, count: number): [number, number] {
  const margin = 6;
  const spacing = (bodyW - margin * 2) / (count - 1);
  return [
    bodyX + margin + Math.floor((count - 1) / 2) * spacing,
    bodyX + margin + Math.ceil((count - 1) / 2) * spacing,
  ];
}

/** Standard handles shared by all variants — computed from w, h, and actual pin positions */
function defaultHandles(w: number, h: number, pinPair?: [number, number]): HandleSpec[] {
  const [bLeft, bRight] = pinPair ?? [w / 2 - 3, w / 2 + 3];
  return [
    { id: 'bottom', type: 'source', position: Position.Bottom, offset: bLeft },
    { id: 'bottom-in', type: 'target', position: Position.Bottom, offset: bRight },
    { id: 'left', type: 'target', position: Position.Left, offset: h / 2 },
    { id: 'right', type: 'target', position: Position.Right, offset: h / 2 },
  ];
}

export const VARIANTS: Record<SystemComponentType, VariantModule> = {
  cpu: {
    w: 200, h: 170,
    refDesignator: 'U1',
    layout: { body: { x: 14, y: 10, w: 172, h: 140 } },
    defaultHandles: defaultHandles(200, 170, gullPinPair(14, 172, 6)),
    Component: CpuChip,
  },
  network: {
    w: 215, h: 130,
    refDesignator: 'U2',
    layout: { body: { x: 8, y: 8, w: 199, h: 104 } },
    defaultHandles: defaultHandles(215, 130, edgePinPair(8, 199, 12)),
    Component: NetworkChip,
  },
  command: {
    w: 175, h: 130,
    refDesignator: 'U3',
    layout: { body: { x: 14, y: 8, w: 147, h: 104 } },
    defaultHandles: defaultHandles(175, 130, gullPinPair(14, 147, 5)),
    Component: CommandChip,
  },
  filesystem: {
    w: 215, h: 140,
    refDesignator: 'U4',
    layout: { body: { x: 8, y: 8, w: 199, h: 114 } },
    defaultHandles: defaultHandles(215, 140), // no bottom pins, keep centered
    Component: FilesystemChip,
  },
  memory: {
    w: 240, h: 100,
    refDesignator: 'U5',
    layout: { body: { x: 4, y: 8, w: 232, h: 74 } },
    defaultHandles: defaultHandles(240, 100, fingerPinPair(4, 232, 24)),
    Component: MemoryChip,
  },
  monitoring: {
    w: 170, h: 130,
    refDesignator: 'U6',
    layout: { body: { x: 14, y: 8, w: 142, h: 104 } },
    defaultHandles: defaultHandles(170, 130, gullPinPair(14, 142, 4)),
    Component: MonitoringChip,
  },
  logs: {
    w: 170, h: 130,
    refDesignator: 'U7',
    layout: { body: { x: 14, y: 8, w: 142, h: 104 } },
    defaultHandles: defaultHandles(170, 130, gullPinPair(14, 142, 4)),
    Component: LogsChip,
  },
  secrets: {
    w: 170, h: 130,
    refDesignator: 'U8',
    layout: { body: { x: 14, y: 8, w: 142, h: 104 } },
    defaultHandles: defaultHandles(170, 130, gullPinPair(14, 142, 4)),
    Component: SecretsChip,
  },
  'policy-graph': {
    w: 170, h: 130,
    refDesignator: 'U9',
    layout: { body: { x: 14, y: 8, w: 142, h: 104 } },
    defaultHandles: defaultHandles(170, 130, gullPinPair(14, 142, 4)),
    Component: PolicyGraphChip,
  },
};

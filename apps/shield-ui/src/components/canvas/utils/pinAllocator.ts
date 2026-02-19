/**
 * Pin Allocator — assigns unique handle positions for every wire endpoint.
 *
 * Given a list of ConnectionIntents and node dimensions, distributes pins
 * evenly along each node's edge so that no two wires share a handle position.
 * Pins are sorted by orderHint (X of opposite-end for top/bottom sides,
 * Y for left/right) to prevent wire crossings.
 */

import { Position } from '@xyflow/react';
import type {
  ConnectionIntent,
  PinAllocationResult,
  HandleSpec,
} from '../Canvas.types';

interface PinAllocatorConfig {
  /** Minimum pixels between adjacent pins (default: 8) */
  minPinSpacing?: number;
  /** Margin from edge ends where pins won't be placed (default: 15) */
  edgeMargin?: number;
  /** Gap between pins within the same pair group (default: 0, disabled) */
  intraPairGap?: number;
}

/** Internal endpoint descriptor — one per wire per side */
interface PinRequest {
  edgeId: string;
  /** 'source' or 'target' — which end of the edge this pin belongs to */
  endpointRole: 'source' | 'target';
  /** Handle type for ReactFlow */
  handleType: 'source' | 'target';
  nodeId: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Sorting key: X or Y of opposite-end node */
  orderHint: number;
}

const SIDE_TO_POSITION: Record<string, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

export function allocatePins(
  intents: ConnectionIntent[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  config?: PinAllocatorConfig,
): PinAllocationResult {
  const minSpacing = config?.minPinSpacing ?? 8;
  const edgeMargin = config?.edgeMargin ?? 15;
  const intraPairGap = config?.intraPairGap ?? 0;

  // 1. Build pin requests from intents
  const pinRequests: PinRequest[] = [];

  for (const intent of intents) {
    // Source side — allocate unless fixed
    if (!intent.sourceFixedHandle) {
      pinRequests.push({
        edgeId: intent.edgeId,
        endpointRole: 'source',
        handleType: intent.sourceHandleType,
        nodeId: intent.sourceNodeId,
        side: intent.sourceSide,
        orderHint: intent.sourceOrderHint,
      });
    }
    // Target side — allocate unless fixed
    if (!intent.targetFixedHandle) {
      pinRequests.push({
        edgeId: intent.edgeId,
        endpointRole: 'target',
        handleType: intent.targetHandleType,
        nodeId: intent.targetNodeId,
        side: intent.targetSide,
        orderHint: intent.targetOrderHint,
      });
    }
  }

  // 2. Group by (nodeId, side)
  const groupKey = (nodeId: string, side: string) => `${nodeId}::${side}`;
  const groups = new Map<string, PinRequest[]>();

  for (const req of pinRequests) {
    const key = groupKey(req.nodeId, req.side);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(req);
  }

  // 3. Sort each group by orderHint (monotonic ordering prevents crossings)
  for (const group of groups.values()) {
    group.sort((a, b) => a.orderHint - b.orderHint);
  }

  // 4. Distribute pins and build results
  const nodeHandles = new Map<string, HandleSpec[]>();
  const edgeHandleMap = new Map<string, { sourceHandle?: string; targetHandle?: string }>();

  // Initialize edge handle entries with fixed handles
  for (const intent of intents) {
    const entry: { sourceHandle?: string; targetHandle?: string } = {};
    if (intent.sourceFixedHandle) entry.sourceHandle = intent.sourceFixedHandle;
    if (intent.targetFixedHandle) entry.targetHandle = intent.targetFixedHandle;
    edgeHandleMap.set(intent.edgeId, entry);
  }

  for (const [key, group] of groups) {
    const [nodeId, side] = key.split('::');
    const dims = nodeDimensions.get(nodeId);
    if (!dims) continue;

    // Edge length depends on side orientation
    const isHorizontal = side === 'top' || side === 'bottom';
    const edgeLength = isHorizontal ? dims.width : dims.height;

    const N = group.length;
    const availableSpan = edgeLength - 2 * edgeMargin;

    // Get or create node handle array
    let handles = nodeHandles.get(nodeId);
    if (!handles) {
      handles = [];
      nodeHandles.set(nodeId, handles);
    }

    const position = SIDE_TO_POSITION[side];

    // Compute offsets using paired distribution when intraPairGap > 0
    let offsets: number[];

    if (intraPairGap > 0 && N > 1) {
      // Partition pins into pair groups — consecutive runs with identical orderHint
      const pairGroups: PinRequest[][] = [];
      let currentGroup: PinRequest[] = [group[0]];
      for (let i = 1; i < N; i++) {
        if (group[i].orderHint === currentGroup[0].orderHint) {
          currentGroup.push(group[i]);
        } else {
          pairGroups.push(currentGroup);
          currentGroup = [group[i]];
        }
      }
      pairGroups.push(currentGroup);

      const G = pairGroups.length;

      if (G === 1 || (N <= 2 && G > 1)) {
        // Single group or ≤2 pins — center them tightly
        const tightGap = intraPairGap;
        const totalSpread = (N - 1) * tightGap;
        const center = edgeLength / 2;
        offsets = group.map((_, idx) => center - totalSpread / 2 + idx * tightGap);
      } else {
        // Multiple groups — two-level spacing
        const totalPairWidth = pairGroups.reduce(
          (sum, pg) => sum + (pg.length - 1) * intraPairGap, 0,
        );
        const remaining = availableSpan - totalPairWidth;
        const interGroupGap = Math.max(remaining / (G - 1), minSpacing);

        offsets = [];
        let groupCenterOffset = edgeMargin;
        for (let g = 0; g < G; g++) {
          const pg = pairGroups[g];
          const pgWidth = (pg.length - 1) * intraPairGap;
          // First group starts at edgeMargin + half its width (center-based)
          // Recalculate: distribute group centers across the span
          if (g === 0) {
            groupCenterOffset = edgeMargin + pgWidth / 2;
          }
          const groupStart = groupCenterOffset - pgWidth / 2;
          for (let p = 0; p < pg.length; p++) {
            offsets.push(groupStart + p * intraPairGap);
          }
          groupCenterOffset += pgWidth / 2 + interGroupGap + (g + 1 < G ? (pairGroups[g + 1].length - 1) * intraPairGap / 2 : 0);
        }
      }
    } else if (N <= 2 && intraPairGap > 0) {
      // ≤2 pins with intraPairGap — center them tightly
      const tightGap = intraPairGap;
      const totalSpread = (N - 1) * tightGap;
      const startOffset = edgeLength / 2 - totalSpread / 2;
      offsets = group.map((_, idx) => startOffset + idx * tightGap);
    } else {
      // Uniform distribution (original algorithm)
      let spacing: number;
      if (N <= 1) {
        spacing = 0;
      } else {
        spacing = Math.max(availableSpan / (N - 1), minSpacing);
      }
      const totalSpread = (N - 1) * spacing;
      const startOffset = edgeLength / 2 - totalSpread / 2;
      offsets = group.map((_, idx) => startOffset + idx * spacing);
    }

    group.forEach((req, idx) => {
      const offset = offsets[idx];
      const handleId = `${side}-pin-${handles!.length}`;

      handles!.push({
        id: handleId,
        type: req.handleType,
        position,
        offset,
      });

      // Assign to edge
      const edgeEntry = edgeHandleMap.get(req.edgeId)!;
      if (req.endpointRole === 'source') {
        edgeEntry.sourceHandle = handleId;
      } else {
        edgeEntry.targetHandle = handleId;
      }
    });
  }

  // Convert edgeHandleMap to final form (assert both handles are set)
  const edgeHandles = new Map<string, { sourceHandle: string; targetHandle: string }>();
  for (const [edgeId, entry] of edgeHandleMap) {
    edgeHandles.set(edgeId, {
      sourceHandle: entry.sourceHandle ?? '',
      targetHandle: entry.targetHandle ?? '',
    });
  }

  return { nodeHandles, edgeHandles };
}

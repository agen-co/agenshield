/**
 * HiddenChipNode — ReactFlow node that shows "N hidden" count with restore popover.
 *
 * Rendered as a PCB silkscreen label below the broker rows.
 * Clicking opens a popover listing dismissed app names with "Restore" buttons.
 */

import React, { memo, useState, useCallback, useRef } from 'react';
import { type NodeProps } from '@xyflow/react';
import { EyeOff, RotateCcw } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import Popover from '@mui/material/Popover';
import { pcb } from '../styles/pcb-tokens';
import type { HiddenChipData } from '../Canvas.types';
import { restoreCard } from '../../../state/setup-panel';

export const HiddenChipNode = memo(({ data }: NodeProps) => {
  const { count, dismissedIds, dismissedNames } = data as unknown as HiddenChipData;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setAnchorEl(chipRef.current);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleRestore = useCallback((id: string) => {
    restoreCard(id);
    // Close popover if no more dismissed cards
    if (dismissedIds.length <= 1) {
      setAnchorEl(null);
    }
  }, [dismissedIds.length]);

  const open = Boolean(anchorEl);

  const silkColor = isDark ? pcb.silk.dim : '#6A6A6A';
  const chipBg = isDark ? 'rgba(30,32,36,0.8)' : 'rgba(228,228,222,0.8)';
  const chipBorder = isDark ? 'rgba(60,60,60,0.3)' : 'rgba(100,100,100,0.3)';

  return (
    <div
      ref={chipRef}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 4,
        border: `1px solid ${chipBorder}`,
        backgroundColor: chipBg,
        cursor: 'pointer',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9,
        letterSpacing: 0.5,
        color: silkColor,
        whiteSpace: 'nowrap',
        transition: 'background-color 0.15s',
      }}
    >
      <EyeOff size={10} color={silkColor} />
      {count} hidden

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 1,
              minWidth: 160,
              maxWidth: 240,
              backgroundColor: isDark ? '#1E2024' : '#F5F5F0',
              border: `1px solid ${chipBorder}`,
              borderRadius: 1,
              fontFamily: "'IBM Plex Mono', monospace",
            },
          },
        }}
      >
        <div style={{ fontSize: 9, color: silkColor, letterSpacing: 0.5, marginBottom: 6, opacity: 0.6 }}>
          HIDDEN TARGETS
        </div>
        {dismissedIds.map((id) => (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 0',
              borderTop: `1px solid ${chipBorder}`,
            }}
          >
            <span style={{
              fontSize: 10,
              color: theme.palette.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {dismissedNames[id] ?? id}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRestore(id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 6px',
                border: 'none',
                borderRadius: 3,
                backgroundColor: isDark ? 'rgba(60,60,60,0.5)' : 'rgba(180,180,180,0.3)',
                color: theme.palette.text.secondary,
                fontSize: 9,
                cursor: 'pointer',
                fontFamily: "'IBM Plex Mono', monospace",
                flexShrink: 0,
              }}
            >
              <RotateCcw size={8} />
              Restore
            </button>
          </div>
        ))}
      </Popover>
    </div>
  );
});
HiddenChipNode.displayName = 'HiddenChipNode';

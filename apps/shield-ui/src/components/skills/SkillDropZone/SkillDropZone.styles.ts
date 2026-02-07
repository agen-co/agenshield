import { styled } from '@mui/material/styles';

export const DropZoneRoot = styled('div', {
  name: 'SkillDropZone',
  slot: 'Root',
})({
  position: 'relative',
});

export const DropOverlay = styled('div', {
  name: 'SkillDropZone',
  slot: 'Overlay',
  shouldForwardProp: (prop) => prop !== '$active',
})<{ $active: boolean }>(({ theme, $active }) => ({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: (theme.shape.borderRadius as number) * 2,
  border: `2px dashed ${$active ? theme.palette.primary.main : 'transparent'}`,
  backgroundColor: $active
    ? theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(0, 0, 0, 0.04)'
    : 'transparent',
  pointerEvents: $active ? 'auto' : 'none',
  opacity: $active ? 1 : 0,
  transition: 'opacity 200ms ease, border-color 200ms ease',
  zIndex: 10,
}));

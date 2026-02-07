import { useState, useCallback, type DragEvent, type ReactNode } from 'react';
import { Typography } from '@mui/material';
import { Upload } from 'lucide-react';
import { DropZoneRoot, DropOverlay } from './SkillDropZone.styles';

interface SkillDropZoneProps {
  onDrop: (file: File) => void;
  children: ReactNode;
}

export function SkillDropZone({ onDrop, children }: SkillDropZoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only activate for files
    if (e.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate when leaving the root element
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX, clientY } = e;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.zip')) {
        onDrop(file);
      }
    },
    [onDrop],
  );

  return (
    <DropZoneRoot
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DropOverlay $active={dragActive}>
        <Typography
          variant="body1"
          color="primary"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 500 }}
        >
          <Upload size={20} />
          Drop skill ZIP to analyze
        </Typography>
      </DropOverlay>
      {children}
    </DropZoneRoot>
  );
}

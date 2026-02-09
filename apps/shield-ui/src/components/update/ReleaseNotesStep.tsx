/**
 * Release Notes Step — displays aggregated release notes for pending migrations
 */

import { Box, Typography, Button } from '@mui/material';
import { ArrowRight } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { updateStore } from '../../state/update';
import { slideIn } from '../../styles/animations';

interface ReleaseNotesStepProps {
  onNext: () => void;
}

export function ReleaseNotesStep({ onNext }: ReleaseNotesStepProps) {
  const { updateState } = useSnapshot(updateStore);

  const fromVersion = updateState?.fromVersion ?? '?';
  const toVersion = updateState?.toVersion ?? '?';
  const releaseNotes = updateState?.releaseNotes ?? '';

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Update Available
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
        Version {fromVersion} &rarr; {toVersion}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Review the changes below before proceeding.
      </Typography>

      {releaseNotes && (
        <Box
          sx={{
            p: 2.5,
            mb: 3,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            maxHeight: 360,
            overflow: 'auto',
            '& h2': { fontSize: '1.1rem', fontWeight: 700, mt: 0, mb: 1 },
            '& h3': { fontSize: '0.95rem', fontWeight: 600, mt: 2, mb: 0.5 },
            '& ul': { pl: 2.5, my: 0.5 },
            '& li': { fontSize: '0.875rem', lineHeight: 1.6 },
            '& hr': { my: 2, borderColor: 'divider' },
            '& code': {
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              bgcolor: 'action.hover',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '0.8rem',
            },
          }}
          dangerouslySetInnerHTML={{
            __html: releaseNotes
              .replace(/^## (.+)$/gm, '<h2>$1</h2>')
              .replace(/^### (.+)$/gm, '<h3>$1</h3>')
              .replace(/^- (.+)$/gm, '<li>$1</li>')
              .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
              .replace(/`([^`]+)`/g, '<code>$1</code>')
              .replace(/---/g, '<hr/>')
              .replace(/\n\n/g, '<br/>'),
          }}
        />
      )}

      <Button
        variant="contained"
        size="large"
        onClick={onNext}
        endIcon={<ArrowRight size={18} />}
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        Continue
      </Button>
    </Box>
  );
}

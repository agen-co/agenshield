import { useState, useCallback } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Typography,
} from '@mui/material';
import { Trash2, Plus } from 'lucide-react';
import { useWorkspacePaths, useGrantWorkspacePath, useRevokeWorkspacePath } from '../../../api/hooks';
import { useGuardedAction } from '../../../hooks/useGuardedAction';
import { PathAutocomplete } from '../PathAutocomplete';

export function WorkspacePathsList() {
  const { data: paths, isLoading } = useWorkspacePaths();
  const grantMutation = useGrantWorkspacePath();
  const revokeMutation = useRevokeWorkspacePath();
  const guard = useGuardedAction();

  const [newPath, setNewPath] = useState('');

  const handleGrant = useCallback(() => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    guard(() => {
      grantMutation.mutate({ path: trimmed }, {
        onSuccess: () => setNewPath(''),
      });
    }, { description: 'Unlock to grant workspace path access.', actionLabel: 'Grant' });
  }, [newPath, guard, grantMutation]);

  const handleRevoke = useCallback((path: string, profileId: string) => {
    guard(() => {
      revokeMutation.mutate({ path, profileId });
    }, { description: 'Unlock to revoke workspace path access.', actionLabel: 'Revoke' });
  }, [guard, revokeMutation]);

  const busy = grantMutation.isPending || revokeMutation.isPending;

  if (isLoading) return null;

  return (
    <Box>
      {paths.map((entry) => (
        <Box
          key={`${entry.profileId}:${entry.path}`}
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1.5,
            borderBottom: `1px solid ${theme.palette.divider}`,
            '&:last-of-type': { borderBottom: 'none' },
          })}
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              flex: 1,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 13,
              minWidth: 0,
            }}
          >
            {entry.path}
          </Typography>

          <Chip
            size="small"
            label={entry.profileName}
            variant="outlined"
            sx={{ fontSize: 10, height: 18, flexShrink: 0 }}
          />

          <IconButton
            size="small"
            color="error"
            onClick={() => handleRevoke(entry.path, entry.profileId)}
            disabled={busy}
          >
            <Trash2 size={14} />
          </IconButton>
        </Box>
      ))}

      {/* Add row */}
      <Box sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderTop: paths.length > 0 ? `1px solid ${theme.palette.divider}` : 'none',
        bgcolor: theme.palette.action.hover,
      })}>
        <PathAutocomplete
          value={newPath}
          onChange={setNewPath}
          onCommit={(path) => setNewPath(path)}
          placeholder="/path/to/workspace"
        />

        <Button
          size="small"
          variant="outlined"
          startIcon={<Plus size={14} />}
          onClick={handleGrant}
          disabled={!newPath.trim() || busy}
        >
          Grant
        </Button>
      </Box>
    </Box>
  );
}

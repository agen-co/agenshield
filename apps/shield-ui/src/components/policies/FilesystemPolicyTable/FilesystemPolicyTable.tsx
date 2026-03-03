import { useState, useCallback, memo } from 'react';
import {
  Box,
  Switch,
  Checkbox,
  IconButton,
  Chip,
  Typography,
  Button,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { Trash2, Plus } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { StatusBadge } from '../../shared/StatusBadge';
import { PathAutocomplete } from '../PathAutocomplete';

const ACTION_VARIANT: Record<string, 'success' | 'error' | 'warning'> = {
  allow: 'success',
  deny: 'error',
  approval: 'warning',
};

interface FilesystemPolicyTableProps {
  policies: PolicyConfig[];
  onToggle: (id: string, enabled: boolean) => void;
  onUpdate: (policy: PolicyConfig) => void;
  onAdd: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
  busy?: boolean;
}

interface InlineRow {
  pattern: string;
  read: boolean;
  write: boolean;
  action: 'allow' | 'deny';
}

const rowSx = (theme: any) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
  '&:last-child': { borderBottom: 'none' },
});

/* ── Memoized row ─────────────────────────────────────────── */

interface FilesystemRowProps {
  policy: PolicyConfig;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: (policy: PolicyConfig) => void;
  onCommitEdit: (policy: PolicyConfig, path: string) => void;
  onCancelEdit: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onToggleOp: (policy: PolicyConfig, op: string) => void;
  onToggleAction: (policy: PolicyConfig, action: 'allow' | 'deny') => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}

const FilesystemRow = memo(function FilesystemRow({
  policy,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onToggleOp,
  onToggleAction,
  onDelete,
  busy,
}: FilesystemRowProps) {
  return (
    <Box sx={rowSx}>
      <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
        <Switch
          checked={policy.enabled}
          onChange={(e) => onToggle(policy.id, e.target.checked)}
          disabled={busy}
        />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          <PathAutocomplete
            value={editValue}
            onChange={onEditValueChange}
            onCommit={(path) => onCommitEdit(policy, path)}
            onCancel={onCancelEdit}
            autoFocus
            placeholder="/path/to/directory/**"
          />
        ) : (
          <Typography
            variant="body2"
            noWrap
            onClick={() => onStartEdit(policy)}
            sx={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 13,
              cursor: 'pointer',
              py: 0.5,
              '&:hover': { textDecoration: 'underline', textDecorationStyle: 'dotted' },
            }}
          >
            {policy.patterns[0] ?? ''}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        <Checkbox
          size="small"
          checked={(policy.operations ?? []).includes('file_read')}
          onChange={() => onToggleOp(policy, 'file_read')}
          disabled={busy}
          sx={{ p: 0.5 }}
        />
        <Typography variant="caption" color="text.secondary">Read</Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        <Checkbox
          size="small"
          checked={(policy.operations ?? []).includes('file_write')}
          onChange={() => onToggleOp(policy, 'file_write')}
          disabled={busy}
          sx={{ p: 0.5 }}
        />
        <Typography variant="caption" color="text.secondary">Write</Typography>
      </Box>

      {policy.preset ? (
        <StatusBadge
          label={policy.action}
          variant={ACTION_VARIANT[policy.action] ?? 'success'}
          dot={false}
          size="small"
        />
      ) : (
        <ToggleButtonGroup
          value={policy.action}
          exclusive
          size="small"
          onChange={(_, val) => { if (val) onToggleAction(policy, val); }}
          disabled={busy}
          sx={{ height: 24 }}
        >
          <ToggleButton value="allow" sx={{ fontSize: 11, px: 1, py: 0, textTransform: 'none' }}>Allow</ToggleButton>
          <ToggleButton value="deny" sx={{ fontSize: 11, px: 1, py: 0, textTransform: 'none' }}>Deny</ToggleButton>
        </ToggleButtonGroup>
      )}

      {policy.preset ? (
        <Chip
          size="small"
          label={policy.preset === 'openclaw' ? 'OpenClaw' : policy.preset}
          color="info"
          variant="outlined"
          sx={{ fontSize: 10, height: 18 }}
        />
      ) : (
        <IconButton
          size="small"
          color="error"
          onClick={() => onDelete(policy.id)}
          disabled={busy}
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </Box>
  );
}, (prev, next) => {
  if (prev.busy !== next.busy) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isEditing && prev.editValue !== next.editValue) return false;
  if (prev.onToggle !== next.onToggle || prev.onDelete !== next.onDelete || prev.onToggleOp !== next.onToggleOp || prev.onToggleAction !== next.onToggleAction) return false;
  if (prev.onStartEdit !== next.onStartEdit || prev.onCommitEdit !== next.onCommitEdit || prev.onCancelEdit !== next.onCancelEdit) return false;
  if (prev.onEditValueChange !== next.onEditValueChange) return false;
  const a = prev.policy, b = next.policy;
  return a.id === b.id && a.enabled === b.enabled && a.name === b.name &&
    a.action === b.action && a.preset === b.preset &&
    a.patterns.length === b.patterns.length &&
    a.patterns.every((p, i) => p === b.patterns[i]) &&
    (a.operations ?? []).length === (b.operations ?? []).length &&
    (a.operations ?? []).every((o, i) => o === (b.operations ?? [])[i]);
});

/* ── Main component ──────────────────────────────────────── */

export function FilesystemPolicyTable({
  policies,
  onToggle,
  onUpdate,
  onAdd,
  onDelete,
  readOnly,
  busy,
}: FilesystemPolicyTableProps) {
  const [newRow, setNewRow] = useState<InlineRow>({ pattern: '', read: false, write: false, action: 'allow' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAddRule = useCallback(() => {
    if (!newRow.pattern.trim()) return;
    const ops: string[] = [];
    if (newRow.read) ops.push('file_read');
    if (newRow.write) ops.push('file_write');
    if (ops.length === 0) return;

    const policy: PolicyConfig = {
      id: crypto.randomUUID(),
      name: newRow.pattern.trim(),
      action: newRow.action,
      target: 'filesystem',
      patterns: [newRow.pattern.trim()],
      operations: ops,
      enabled: true,
    };
    onAdd(policy);
    setNewRow({ pattern: '', read: false, write: false, action: 'allow' });
  }, [newRow, onAdd]);

  const startEdit = useCallback((policy: PolicyConfig) => {
    setEditingId(policy.id);
    setEditValue(policy.patterns[0] ?? '');
  }, []);

  const commitEdit = useCallback((policy: PolicyConfig, path: string) => {
    const val = path.trim();
    if (!val) {
      setEditingId(null);
      return;
    }
    onUpdate({
      ...policy,
      patterns: [val],
      name: val,
    });
    setEditingId(null);
  }, [onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleEditValueChange = useCallback((value: string) => {
    setEditValue(value);
  }, []);

  const toggleAction = useCallback((policy: PolicyConfig, action: 'allow' | 'deny') => {
    onUpdate({ ...policy, action });
  }, [onUpdate]);

  const toggleOp = useCallback((policy: PolicyConfig, op: string) => {
    const ops = policy.operations ?? [];
    const newOps = ops.includes(op)
      ? ops.filter((o) => o !== op)
      : [...ops, op];
    if (newOps.length === 0) return;
    onUpdate({ ...policy, operations: newOps });
  }, [onUpdate]);

  return (
    <Box>
      {policies.map((policy) => (
        <FilesystemRow
          key={policy.id}
          policy={policy}
          isEditing={editingId === policy.id}
          editValue={editingId === policy.id ? editValue : ''}
          onEditValueChange={handleEditValueChange}
          onStartEdit={startEdit}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
          onToggle={onToggle}
          onToggleOp={toggleOp}
          onToggleAction={toggleAction}
          onDelete={onDelete}
          busy={busy}
        />
      ))}

      {/* Add rule row */}
      <Box sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderTop: policies.length > 0 ? `1px solid ${theme.palette.divider}` : 'none',
          bgcolor: theme.palette.action.hover,
        })}>
          <PathAutocomplete
            value={newRow.pattern}
            onChange={(val) => setNewRow({ ...newRow, pattern: val })}
            onCommit={(path) => setNewRow({ ...newRow, pattern: path })}
            placeholder="/path/to/directory/**"
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Checkbox
              size="small"
              checked={newRow.read}
              onChange={(e) => setNewRow({ ...newRow, read: e.target.checked })}
            />
            <Typography variant="caption" color="text.secondary">Read</Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Checkbox
              size="small"
              checked={newRow.write}
              onChange={(e) => setNewRow({ ...newRow, write: e.target.checked })}
            />
            <Typography variant="caption" color="text.secondary">Write</Typography>
          </Box>

          <ToggleButtonGroup
            value={newRow.action}
            exclusive
            size="small"
            onChange={(_, val) => { if (val) setNewRow({ ...newRow, action: val }); }}
            sx={{ height: 24 }}
          >
            <ToggleButton value="allow" sx={{ fontSize: 11, px: 1, py: 0, textTransform: 'none' }}>Allow</ToggleButton>
            <ToggleButton value="deny" sx={{ fontSize: 11, px: 1, py: 0, textTransform: 'none' }}>Deny</ToggleButton>
          </ToggleButtonGroup>

          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={14} />}
            onClick={handleAddRule}
            disabled={!newRow.pattern.trim() || (!newRow.read && !newRow.write)}
          >
            Add
          </Button>
        </Box>
    </Box>
  );
}

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
} from '@mui/material';
import type { SecretScope, CreateSecretRequest } from '../../../api/client';
import { SecretTypeSelector } from '../SecretTypeSelector';

interface SecretFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: CreateSecretRequest) => void;
  saving?: boolean;
}

export function SecretForm({ open, onClose, onSave, saving }: SecretFormProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [scopeType, setScopeType] = useState('global');
  const [pattern, setPattern] = useState('');
  const [skillId, setSkillId] = useState('');

  const resetForm = () => {
    setName('');
    setValue('');
    setScopeType('global');
    setPattern('');
    setSkillId('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSave = () => {
    let scope: SecretScope;
    switch (scopeType) {
      case 'command':
        scope = { type: 'command', pattern };
        break;
      case 'url':
        scope = { type: 'url', pattern };
        break;
      case 'skill':
        scope = { type: 'skill', skillId };
        break;
      default:
        scope = { type: 'global' };
    }

    onSave({ name, value, scope });
    resetForm();
  };

  const isValid = name.trim() && value.trim() && (
    scopeType === 'global' ||
    (scopeType === 'command' && pattern.trim()) ||
    (scopeType === 'url' && pattern.trim()) ||
    (scopeType === 'skill' && skillId.trim())
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Secret</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            placeholder="e.g. DATABASE_URL"
          />
          <TextField
            label="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            fullWidth
            type="password"
            placeholder="Enter secret value"
          />

          <SecretTypeSelector value={scopeType} onChange={setScopeType} />

          {(scopeType === 'command' || scopeType === 'url') && (
            <TextField
              label={scopeType === 'command' ? 'Command Pattern' : 'URL Pattern'}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              fullWidth
              placeholder={
                scopeType === 'command'
                  ? 'e.g. psql, aws s3 *'
                  : 'e.g. api.example.com/*'
              }
              helperText={
                scopeType === 'command'
                  ? 'Command or glob pattern to match'
                  : 'URL or glob pattern to match'
              }
            />
          )}

          {scopeType === 'skill' && (
            <TextField
              label="Skill ID"
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              fullWidth
              placeholder="e.g. my-skill-name"
              helperText="The skill this secret is tied to"
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!isValid || saving}>
          {saving ? 'Saving...' : 'Add Secret'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

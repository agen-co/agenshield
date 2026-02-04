import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
} from '@mui/material';
import type { PolicyConfig } from '@agenshield/ipc';

interface PolicyEditorProps {
  open: boolean;
  policy: PolicyConfig | null;
  onSave: (policy: PolicyConfig) => void;
  onClose: () => void;
}

export function PolicyEditor({ open, policy, onSave, onClose }: PolicyEditorProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'allowlist' as 'allowlist' | 'denylist',
    patterns: '',
    enabled: true,
  });

  useEffect(() => {
    if (policy) {
      setFormData({
        name: policy.name,
        type: policy.type,
        patterns: policy.patterns.join('\n'),
        enabled: policy.enabled,
      });
    } else {
      setFormData({ name: '', type: 'allowlist', patterns: '', enabled: true });
    }
  }, [policy, open]);

  const handleSave = () => {
    const newPolicy: PolicyConfig = {
      id: policy?.id ?? crypto.randomUUID(),
      name: formData.name,
      type: formData.type,
      patterns: formData.patterns.split('\n').filter((p) => p.trim()),
      enabled: formData.enabled,
    };
    onSave(newPolicy);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{policy ? 'Edit Policy' : 'Add Policy'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={formData.type}
              label="Type"
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value as 'allowlist' | 'denylist' })
              }
            >
              <MenuItem value="allowlist">Allowlist</MenuItem>
              <MenuItem value="denylist">Denylist</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Patterns (one per line)"
            value={formData.patterns}
            onChange={(e) => setFormData({ ...formData, patterns: e.target.value })}
            multiline
            rows={4}
            fullWidth
            placeholder={"*.example.com\nhttps://api.safe.com/*"}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!formData.name || !formData.patterns}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

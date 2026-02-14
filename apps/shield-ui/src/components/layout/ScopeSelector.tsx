/**
 * Scope selector for multi-tenancy — dropdown to switch profile scope
 */

import { useSnapshot } from 'valtio';
import {
  Box,
  Select,
  MenuItem,
  Typography,
  type SelectChangeEvent,
} from '@mui/material';
import { Target } from 'lucide-react';
import { scopeStore, setScope } from '../../state/scope';
import { useProfiles } from '../../api/hooks';

const GLOBAL_VALUE = '__global__';

export function ScopeSelector() {
  const { profileId } = useSnapshot(scopeStore);
  const { data: profilesResp } = useProfiles();
  const profiles = profilesResp?.data ?? [];

  if (profiles.length === 0) return null;

  const handleChange = (e: SelectChangeEvent<string>) => {
    const value = e.target.value;
    if (value === GLOBAL_VALUE) {
      setScope(null);
    } else {
      setScope(value);
    }
  };

  return (
    <Box sx={{ px: 2, pb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Scope
      </Typography>
      <Select
        size="small"
        fullWidth
        value={profileId ?? GLOBAL_VALUE}
        onChange={handleChange}
        renderValue={(selected) => {
          if (selected === GLOBAL_VALUE) return 'Global (base)';
          const p = profiles.find((p) => p.id === selected);
          return p?.name ?? selected;
        }}
        sx={{
          '.MuiSelect-select': { py: 0.75, display: 'flex', alignItems: 'center', gap: 1 },
        }}
      >
        <MenuItem value={GLOBAL_VALUE}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Target size={14} />
            <Typography variant="body2">Global (base)</Typography>
          </Box>
        </MenuItem>
        {profiles.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Target size={14} />
              <Typography variant="body2">{p.name}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

import { useState, useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  Typography,
  Autocomplete,
} from '@mui/material';
import { Folder, File } from 'lucide-react';
import type { FsBrowseEntry } from '@agenshield/ipc';
import { useBrowsePath } from '../../api/hooks';

export function parseInput(input: string): { parentDir: string; filter: string } {
  if (!input) return { parentDir: '', filter: '' };
  const lastSlash = input.lastIndexOf('/');
  if (lastSlash === -1) return { parentDir: '', filter: input };
  return {
    parentDir: input.slice(0, lastSlash + 1),
    filter: input.slice(lastSlash + 1),
  };
}

export interface PathAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when the user "commits" a final path (Enter on a file, or freeSolo submit) */
  onCommit?: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: 'small' | 'medium';
}

export function PathAutocomplete({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  autoFocus,
  size = 'small',
}: PathAutocompleteProps) {
  const [browseDir, setBrowseDir] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { parentDir } = parseInput(value);
      setBrowseDir(parentDir || null);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  const { data } = useBrowsePath(browseDir);
  const entries: FsBrowseEntry[] = data?.data?.entries ?? [];

  const { filter } = parseInput(value);
  const filtered = filter
    ? entries.filter((e) => e.name.toLowerCase().startsWith(filter.toLowerCase()))
    : entries;

  return (
    <Autocomplete
      freeSolo
      options={filtered}
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : option.path
      }
      inputValue={value}
      onInputChange={(_e, val, reason) => {
        if (reason !== 'reset') onChange(val);
      }}
      onChange={(_e, selected) => {
        if (!selected) return;
        if (typeof selected === 'string') {
          onCommit?.(selected);
          return;
        }
        if (selected.type === 'directory') {
          // Keep browsing into dir
          onChange(selected.path + '/');
        } else {
          onCommit?.(selected.path);
        }
      }}
      filterOptions={(x) => x}
      renderOption={(props, option) => {
        if (typeof option === 'string') return null;
        return (
          <Box
            component="li"
            {...props}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            {option.type === 'directory' ? <Folder size={14} /> : <File size={14} />}
            <Typography variant="body2">{option.name}</Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          size={size}
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              // If the dropdown didn't handle it, commit the raw value
              // (small delay to let Autocomplete onChange fire first)
            }
            if (e.key === 'Escape') onCancel?.();
          }}
          InputProps={{
            ...params.InputProps,
            sx: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 13 },
          }}
        />
      )}
      blurOnSelect={false}
      onBlur={() => {
        if (value.trim()) onCommit?.(value.trim());
      }}
      sx={{ flex: 1, minWidth: 0 }}
    />
  );
}

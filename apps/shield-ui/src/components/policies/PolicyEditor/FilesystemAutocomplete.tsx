import { useState, useEffect, useRef } from 'react';
import { Autocomplete, TextField, Box, Typography } from '@mui/material';
import { Folder, File } from 'lucide-react';
import type { FsBrowseEntry } from '@agenshield/ipc';
import { useBrowsePath } from '../../../api/hooks';

interface FilesystemAutocompleteProps {
  onSelect: (path: string) => void;
}

/**
 * Parse a typed input into the parent directory to browse and a filter prefix.
 * e.g. "/usr/lo" → parentDir="/usr/", filter="lo"
 * e.g. "/usr/" → parentDir="/usr/", filter=""
 */
function parseInput(input: string): { parentDir: string; filter: string } {
  if (!input) return { parentDir: '', filter: '' };
  const lastSlash = input.lastIndexOf('/');
  if (lastSlash === -1) return { parentDir: '', filter: input };
  return {
    parentDir: input.slice(0, lastSlash + 1),
    filter: input.slice(lastSlash + 1),
  };
}

export function FilesystemAutocomplete({ onSelect }: FilesystemAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [browseDir, setBrowseDir] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce: update browseDir after 300ms of typing
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { parentDir } = parseInput(inputValue);
      setBrowseDir(parentDir || null);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [inputValue]);

  const { data } = useBrowsePath(browseDir);
  const entries: FsBrowseEntry[] = data?.data?.entries ?? [];

  // Filter entries by typed prefix
  const { filter } = parseInput(inputValue);
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
      inputValue={inputValue}
      onInputChange={(_e, value, reason) => {
        if (reason !== 'reset') setInputValue(value);
      }}
      onChange={(_e, value) => {
        if (!value) return;
        if (typeof value === 'string') {
          onSelect(value);
          setInputValue('');
          return;
        }
        if (value.type === 'directory') {
          // Continue browsing into the directory
          setInputValue(value.path + '/');
        } else {
          onSelect(value.path);
          setInputValue('');
        }
      }}
      filterOptions={(x) => x} // We handle filtering ourselves
      renderOption={(props, option) => {
        if (typeof option === 'string') return null;
        return (
          <Box
            component="li"
            {...props}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            {option.type === 'directory' ? (
              <Folder size={14} />
            ) : (
              <File size={14} />
            )}
            <Typography variant="body2">{option.name}</Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Browse path"
          placeholder="Type a path, e.g. /Users/me/projects"
          size="small"
        />
      )}
      blurOnSelect={false}
    />
  );
}

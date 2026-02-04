import { ToggleButton, ToggleButtonGroup, Typography, Box } from '@mui/material';
import { Globe, Terminal, Link, Zap } from 'lucide-react';

interface SecretTypeSelectorProps {
  value: string;
  onChange: (type: string) => void;
}

const types = [
  { value: 'global', label: 'Global', icon: <Globe size={16} />, desc: 'Available to all operations' },
  { value: 'command', label: 'Command', icon: <Terminal size={16} />, desc: 'Injected for specific commands' },
  { value: 'url', label: 'URL', icon: <Link size={16} />, desc: 'Injected for specific endpoints' },
  { value: 'skill', label: 'Skill', icon: <Zap size={16} />, desc: 'Tied to a specific skill' },
];

export function SecretTypeSelector({ value, onChange }: SecretTypeSelectorProps) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Scope Type
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, v) => v && onChange(v)}
        size="small"
        fullWidth
      >
        {types.map((t) => (
          <ToggleButton
            key={t.value}
            value={t.value}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              py: 1.5,
              textTransform: 'none',
            }}
          >
            {t.icon}
            <Typography variant="caption" fontWeight={500}>
              {t.label}
            </Typography>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {types.find((t) => t.value === value)?.desc}
      </Typography>
    </Box>
  );
}

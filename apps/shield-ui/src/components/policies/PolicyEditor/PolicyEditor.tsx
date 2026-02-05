import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TextField,
  Box,
  Autocomplete,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  IconButton,
  Chip,
} from '@mui/material';
import { X, Terminal, Zap, Globe, CircleCheck, Ban, Clock } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { useDiscovery, useSkills, useSecrets } from '../../../api/hooks';
import type { Secret } from '../../../api/client';
import { FormCard } from '../../shared/FormCard';

interface PolicyEditorProps {
  policy: PolicyConfig | null;
  onSave: (policy: PolicyConfig, linkedSecretIds: string[]) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  error?: boolean;
  /** Hide the Linked Secrets section (used when embedded in SecretForm) */
  hideSecrets?: boolean;
  /** Override the form card title */
  title?: string;
  /** Override the save button label */
  saveLabel?: string;
  /** Show a loading spinner on save button */
  saving?: boolean;
}

interface CommandOption {
  label: string;
  path?: string;
  sourceKind: string;
}

const SOURCE_LABELS: Record<string, string> = {
  'system': 'sys',
  'homebrew': 'brew',
  'npm-global': 'npm',
  'yarn-global': 'yarn',
  'workspace-bin': 'ws',
  'agent-bin': 'agent',
  'path-other': 'path',
};

export function PolicyEditor({ policy, onSave, onCancel, onDirtyChange, onFocusChange, error, hideSecrets, title, saveLabel, saving }: PolicyEditorProps) {
  const initial = {
    name: policy?.name ?? '',
    action: (policy?.action ?? null) as 'allow' | 'deny' | 'approval' | null,
    target: (policy?.target ?? 'command') as 'skill' | 'command' | 'url',
    patterns: policy?.patterns.join('\n') ?? '',
    enabled: policy?.enabled ?? true,
  };

  const [formData, setFormData] = useState(initial);
  const [secretIds, setSecretIds] = useState<string[]>([]);

  const { data: discoveryData } = useDiscovery();
  const { data: skillsData } = useSkills();
  const { data: secretsData } = useSecrets();

  const secrets = secretsData?.data ?? [];

  // Initialize linked secrets from existing data when editing
  useEffect(() => {
    if (policy) {
      const linked = secrets
        .filter((s) => s.policyIds.includes(policy.id))
        .map((s) => s.id);
      setSecretIds(linked);
    } else {
      setSecretIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.id, secrets.length]);

  // Reset when policy prop changes
  useEffect(() => {
    setFormData({
      name: policy?.name ?? '',
      action: (policy?.action ?? null) as 'allow' | 'deny' | 'approval' | null,
      target: (policy?.target ?? 'command') as 'skill' | 'command' | 'url',
      patterns: policy?.patterns.join('\n') ?? '',
      enabled: policy?.enabled ?? true,
    });
  }, [policy]);

  // Track dirty state
  const dirty =
    formData.name !== initial.name ||
    formData.action !== initial.action ||
    formData.target !== initial.target ||
    formData.patterns !== initial.patterns;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Command autocomplete options from discovery
  const commandOptions = useMemo(() => {
    const bins = discoveryData?.data?.binaries ?? [];
    const seen = new Set<string>();
    return bins
      .filter((b) => {
        if (seen.has(b.name)) return false;
        seen.add(b.name);
        return true;
      })
      .map((b) => ({
        label: b.name,
        path: b.path,
        sourceKind: b.sourceKind,
      }));
  }, [discoveryData]);

  // Skill autocomplete options (merge active skills + discovery)
  const skillOptions = useMemo(() => {
    const fromSkills = (skillsData?.data ?? []).map((s) => ({
      label: s.name,
      description: s.description,
      source: s.source as string,
    }));
    const discoverySkills = (discoveryData?.data?.skills ?? [])
      .filter((ds) => !fromSkills.some((s) => s.label === ds.name))
      .map((ds) => ({
        label: ds.name,
        description: ds.metadata?.description,
        source: 'discovered' as const,
      }));
    return [...fromSkills, ...discoverySkills];
  }, [skillsData, discoveryData]);

  // Available secrets (not yet linked)
  const availableSecrets = useMemo(
    () => secrets.filter((s) => !secretIds.includes(s.id)),
    [secrets, secretIds],
  );

  // Linked secret objects
  const linkedSecrets = useMemo(
    () => secretIds.map((id) => secrets.find((s) => s.id === id)).filter(Boolean) as Secret[],
    [secretIds, secrets],
  );

  const handleSave = useCallback(() => {
    if (!formData.action) return;
    const newPolicy: PolicyConfig = {
      id: policy?.id ?? crypto.randomUUID(),
      name: formData.name,
      action: formData.action,
      target: formData.target,
      patterns: formData.patterns.split('\n').filter((p) => p.trim()),
      enabled: formData.enabled,
    };
    onSave(newPolicy, secretIds);
  }, [policy, formData, secretIds, onSave]);

  const handleAddCommand = (_event: unknown, value: CommandOption | null) => {
    if (!value) return;
    const current = formData.patterns.trim();
    const newPattern = current ? `${current}\n${value.label}` : value.label;
    setFormData({ ...formData, patterns: newPattern });
  };

  const handleAddSkill = (_event: unknown, value: { label: string } | null) => {
    if (!value) return;
    const current = formData.patterns.trim();
    const newPattern = current ? `${current}\n${value.label}` : value.label;
    setFormData({ ...formData, patterns: newPattern });
  };

  return (
    <FormCard
      title={title ?? (policy ? 'Edit Policy' : 'Add Policy')}
      onSave={handleSave}
      onCancel={onCancel}
      saveDisabled={!formData.name || !formData.patterns || !formData.action || formData.action === 'approval'}
      error={error ? 'Failed to update policies. Please try again.' : undefined}
      onFocusChange={onFocusChange}
      saveLabel={saveLabel}
      saving={saving}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          fullWidth
          placeholder="e.g. Allow internal APIs"
        />

        {/* Action selector */}
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Action
          </Typography>
          <ToggleButtonGroup
            value={formData.action}
            exclusive
            onChange={(_e, val) => {
              if (val) setFormData({ ...formData, action: val });
            }}
            size="small"
            fullWidth
          >
            <ToggleButton value="allow" color="success" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <CircleCheck size={16} />
              <Typography variant="caption" fontSize={11}>Allow</Typography>
            </ToggleButton>
            <ToggleButton value="deny" color="error" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <Ban size={16} />
              <Typography variant="caption" fontSize={11}>Deny</Typography>
            </ToggleButton>
            <Tooltip title="Coming soon — requires AgentLink" arrow>
              <span style={{ flex: 1, display: 'flex' }}>
                <ToggleButton value="approval" disabled sx={{ flex: 1, flexDirection: 'column', gap: 0.25, py: 1 }}>
                  <Clock size={16} />
                  <Typography variant="caption" fontSize={11}>Approval</Typography>
                </ToggleButton>
              </span>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* Progressive disclosure — dimmed until action is chosen */}
        <Box sx={{
          opacity: formData.action ? 1 : 0.4,
          pointerEvents: formData.action ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
        }}>

        {/* Target selector */}
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Target
          </Typography>
          <ToggleButtonGroup
            value={formData.target}
            exclusive
            onChange={(_e, val) => {
              if (val) setFormData({ ...formData, target: val, patterns: '' });
            }}
            size="small"
            fullWidth
          >
            <ToggleButton value="command" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <Terminal size={16} />
              <Typography variant="caption" fontSize={11}>Command</Typography>
            </ToggleButton>
            <ToggleButton value="skill" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <Zap size={16} />
              <Typography variant="caption" fontSize={11}>Skill</Typography>
            </ToggleButton>
            <ToggleButton value="url" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <Globe size={16} />
              <Typography variant="caption" fontSize={11}>URL</Typography>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Patterns */}
        <TextField
          label="Patterns (one per line)"
          value={formData.patterns}
          onChange={(e) => setFormData({ ...formData, patterns: e.target.value })}
          multiline
          rows={4}
          fullWidth
          placeholder={
            formData.target === 'command'
              ? 'git push\ngit commit\nnpm *'
              : formData.target === 'skill'
                ? 'my-skill\nworkspace-tool'
                : 'https://api.example.com/*\nhttps://*.internal.io/**'
          }
        />

        {/* Contextual autocomplete */}
        {formData.target === 'command' && commandOptions.length > 0 && (
          <Autocomplete
            options={commandOptions}
            getOptionLabel={(option) => option.label}
            renderOption={(props, option) => (
              <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="body2">{option.label}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <Chip size="small" label={SOURCE_LABELS[option.sourceKind] ?? option.sourceKind}
                        variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  {option.path && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 160 }}>
                      {option.path}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
            onChange={handleAddCommand}
            value={null}
            blurOnSelect
            clearOnBlur
            renderInput={(params) => (
              <TextField
                {...params}
                label="Add command"
                placeholder="Search system commands..."
                size="small"
              />
            )}
          />
        )}

        {formData.target === 'skill' && skillOptions.length > 0 && (
          <Autocomplete
            options={skillOptions}
            getOptionLabel={(option) => option.label}
            renderOption={(props, option) => (
              <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="body2">{option.label}</Typography>
                {option.description && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                    {option.description}
                  </Typography>
                )}
              </Box>
            )}
            onChange={handleAddSkill}
            value={null}
            blurOnSelect
            clearOnBlur
            renderInput={(params) => (
              <TextField
                {...params}
                label="Add skill"
                placeholder="Search skills..."
                size="small"
              />
            )}
          />
        )}

        {/* Linked Secrets */}
        {!hideSecrets && <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Linked Secrets
          </Typography>

          {linkedSecrets.length > 0 && (
            <Box
              sx={(theme) => ({
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                mb: 1.5,
              })}
            >
              {linkedSecrets.map((s) => (
                <Box
                  key={s.id}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1.5,
                    py: 1,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    '&:last-child': { borderBottom: 'none' },
                  })}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography variant="body2" fontWeight={500}>{s.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.maskedValue}</Typography>
                  </Box>
                  <IconButton size="small" onClick={() => setSecretIds((prev) => prev.filter((id) => id !== s.id))}>
                    <X size={14} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          <Autocomplete
            options={availableSecrets}
            getOptionLabel={(option) => option.name}
            renderOption={(props, option) => (
              <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="body2">{option.name}</Typography>
                <Typography variant="caption" color="text.secondary">{option.maskedValue}</Typography>
              </Box>
            )}
            onChange={(_e, val) => {
              if (val) setSecretIds((prev) => [...prev, val.id]);
            }}
            value={null}
            blurOnSelect
            clearOnBlur
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Search secrets..."
                size="small"
              />
            )}
          />
        </Box>}
        </Box>{/* end progressive disclosure */}
      </Box>
    </FormCard>
  );
}

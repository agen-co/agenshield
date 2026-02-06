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
  Checkbox,
  FormControlLabel,
  FormGroup,
} from '@mui/material';
import { X, Terminal, Zap, Globe, FolderOpen, CircleCheck, Ban, Clock } from 'lucide-react';
import type { PolicyConfig, SecurityRisk, CatalogEntry } from '@agenshield/ipc';
import { COMMAND_CATALOG } from '@agenshield/ipc';
import { useDiscovery, useSkills, useSecrets } from '../../../api/hooks';
import type { Secret } from '../../../api/client';
import { FormCard } from '../../shared/FormCard';
import { FilesystemAutocomplete } from './FilesystemAutocomplete';

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
  description?: string;
  risk?: SecurityRisk;
  riskReason?: string;
  tags?: string[];
}

const SOURCE_LABELS: Record<string, string> = {
  'system': 'sys',
  'homebrew': 'brew',
  'npm-global': 'npm',
  'yarn-global': 'yarn',
  'workspace-bin': 'ws',
  'agent-bin': 'agent',
  'path-other': 'path',
  'catalog': 'known',
};

const RISK_COLORS: Record<SecurityRisk, 'error' | 'warning' | 'default'> = {
  high: 'error',
  medium: 'warning',
  low: 'default',
  info: 'default',
};

function scoreCommandOption(option: CommandOption, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const tokens = q.split(/\s+/);
  const nameLower = option.label.toLowerCase();
  const descLower = (option.description ?? '').toLowerCase();

  let totalScore = 0;
  for (const token of tokens) {
    let tokenScore = 0;

    if (nameLower === token) {
      tokenScore = 100;
    } else if (nameLower.startsWith(token)) {
      tokenScore = 60;
    } else if (nameLower.includes(token)) {
      tokenScore = 40;
    }

    if (option.tags) {
      for (const tag of option.tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower === token) {
          tokenScore = Math.max(tokenScore, 30);
        } else if (tagLower.includes(token)) {
          tokenScore = Math.max(tokenScore, 15);
        }
      }
    }

    if (descLower.includes(token)) {
      tokenScore = Math.max(tokenScore, 10);
    }

    totalScore += tokenScore;
  }

  return totalScore;
}

export function PolicyEditor({ policy, onSave, onCancel, onDirtyChange, onFocusChange, error, hideSecrets, title, saveLabel, saving }: PolicyEditorProps) {
  const initial = {
    name: policy?.name ?? '',
    action: (policy?.action ?? null) as 'allow' | 'deny' | 'approval' | null,
    target: (policy?.target ?? 'command') as 'skill' | 'command' | 'url' | 'filesystem',
    patterns: policy?.patterns.join('\n') ?? '',
    enabled: policy?.enabled ?? true,
    operations: policy?.operations ?? [] as string[],
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
      target: (policy?.target ?? 'command') as 'skill' | 'command' | 'url' | 'filesystem',
      patterns: policy?.patterns.join('\n') ?? '',
      enabled: policy?.enabled ?? true,
      operations: policy?.operations ?? [],
    });
  }, [policy]);

  // Track dirty state
  const dirty =
    formData.name !== initial.name ||
    formData.action !== initial.action ||
    formData.target !== initial.target ||
    formData.patterns !== initial.patterns ||
    JSON.stringify(formData.operations) !== JSON.stringify(initial.operations);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Command autocomplete options: discovered binaries enriched with catalog, plus catalog-only entries
  const commandOptions = useMemo(() => {
    const bins = discoveryData?.data?.binaries ?? [];
    const seen = new Set<string>();
    const options: CommandOption[] = [];

    // Discovered binaries enriched with catalog data
    for (const b of bins) {
      if (seen.has(b.name)) continue;
      seen.add(b.name);
      const catalogEntry: CatalogEntry | undefined = COMMAND_CATALOG[b.name];
      options.push({
        label: b.name,
        path: b.path,
        sourceKind: b.sourceKind,
        description: catalogEntry?.description,
        risk: catalogEntry?.risk,
        riskReason: catalogEntry?.riskReason,
        tags: catalogEntry?.tags,
      });
    }

    // Catalog-only entries (not discovered on this system)
    for (const [name, entry] of Object.entries(COMMAND_CATALOG)) {
      if (seen.has(name)) continue;
      seen.add(name);
      options.push({
        label: name,
        sourceKind: 'catalog',
        description: entry.description,
        risk: entry.risk,
        riskReason: entry.riskReason,
        tags: entry.tags,
      });
    }

    return options;
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
      ...(formData.target === 'filesystem' ? { operations: formData.operations } : {}),
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
      saveDisabled={!formData.name || !formData.patterns || !formData.action || formData.action === 'approval' || (formData.target === 'filesystem' && formData.operations.length === 0)}
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
            <Tooltip title="Coming soon — requires AgenCo" arrow>
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
              if (val) setFormData({ ...formData, target: val, patterns: '', operations: [] });
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
            <ToggleButton value="filesystem" sx={{ flexDirection: 'column', gap: 0.25, py: 1 }}>
              <FolderOpen size={16} />
              <Typography variant="caption" fontSize={11}>Filesystem</Typography>
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
                : formData.target === 'filesystem'
                  ? '/Users/me/projects/**\n/tmp/*'
                  : 'example.com\n*.internal.io\nhttps://api.example.com/**'
          }
          helperText={
            formData.target === 'url'
              ? 'Plain HTTP is blocked by default. Use * for single path segment, ** for any path. Bare domains assume HTTPS.'
              : undefined
          }
        />

        {/* Contextual autocomplete */}
        {formData.target === 'command' && commandOptions.length > 0 && (
          <Autocomplete
            options={commandOptions}
            getOptionLabel={(option) => option.label}
            filterOptions={(options, state) => {
              const q = state.inputValue.trim();
              if (!q) return options.slice(0, 20);
              return options
                .map((opt) => ({ opt, score: scoreCommandOption(opt, q) }))
                .filter(({ score }) => score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 20)
                .map(({ opt }) => opt);
            }}
            renderOption={(props, option) => (
              <Box component="li" {...props} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', gap: 0.25, py: 1 }}>
                <Box sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={500}>{option.label}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                    {option.risk && (
                      <Chip size="small" label={option.risk}
                            color={RISK_COLORS[option.risk]}
                            sx={{ fontSize: 10, height: 18 }} />
                    )}
                    <Chip size="small" label={SOURCE_LABELS[option.sourceKind] ?? option.sourceKind}
                          variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  </Box>
                </Box>
                {option.description && (
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {option.description}
                  </Typography>
                )}
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
                placeholder="Search commands by name, tag, or description..."
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

        {formData.target === 'filesystem' && (
          <FilesystemAutocomplete
            onSelect={(path) => {
              const current = formData.patterns.trim();
              const newPattern = current ? `${current}\n${path}` : path;
              setFormData({ ...formData, patterns: newPattern });
            }}
          />
        )}

        {formData.target === 'filesystem' && (
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              Permissions
            </Typography>
            <FormGroup row>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.operations.includes('file_read')}
                    onChange={(e) => {
                      const ops = e.target.checked
                        ? [...formData.operations, 'file_read']
                        : formData.operations.filter((o) => o !== 'file_read');
                      setFormData({ ...formData, operations: ops });
                    }}
                    size="small"
                  />
                }
                label="Read"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.operations.includes('file_write')}
                    onChange={(e) => {
                      const ops = e.target.checked
                        ? [...formData.operations, 'file_write']
                        : formData.operations.filter((o) => o !== 'file_write');
                      setFormData({ ...formData, operations: ops });
                    }}
                    size="small"
                  />
                }
                label="Edit"
              />
            </FormGroup>
            {formData.operations.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                Select at least one permission
              </Typography>
            )}
          </Box>
        )}

        {/* Linked Secrets */}
        {!hideSecrets && formData.target !== 'filesystem' && <Box>
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

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TextField,
  Box,
  Autocomplete,
  Typography,
  Chip,
  Collapse,
  IconButton,
  RadioGroup,
  FormControlLabel,
  Radio,
  Alert,
} from '@mui/material';
import { Plus, X } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import type { CreateSecretRequest, SecretScope } from '../../../api/client';
import { useConfig, useUpdateConfig, useSecrets, useAvailableEnvSecrets } from '../../../api/hooks';
import { FormCard } from '../../shared/FormCard';
import { PolicyEditor } from '../../policies/PolicyEditor/PolicyEditor';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';

interface SecretFormProps {
  onSave: (data: CreateSecretRequest) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  saving?: boolean;
  initialData?: { name: string; policyIds: string[]; scope?: SecretScope };
}

export function SecretForm({ onSave, onCancel, onDirtyChange, onFocusChange, saving, initialData }: SecretFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [value, setValue] = useState('');
  const [availability, setAvailability] = useState<SecretScope>(
    initialData?.scope ?? ((initialData?.policyIds?.length ?? 0) > 0 ? 'policed' : 'global')
  );
  const [policyIds, setPolicyIds] = useState<string[]>(initialData?.policyIds ?? []);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const { data: configData } = useConfig();
  const updateConfig = useUpdateConfig();

  const { data: envSecretsData } = useAvailableEnvSecrets();
  const { data: vaultedData } = useSecrets();

  // Filter out names already in the vault
  const nameOptions = useMemo(() => {
    const envNames = envSecretsData?.data ?? [];
    const vaultedNames = new Set((vaultedData?.data ?? []).map((s) => s.name));
    return envNames.filter((n) => !vaultedNames.has(n));
  }, [envSecretsData, vaultedData]);

  const policies = configData?.data?.policies ?? [];

  const dirty = !!(name || value || policyIds.length > 0);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Available policies (not yet selected)
  const availablePolicies = useMemo(
    () => policies.filter((p) => !policyIds.includes(p.id)),
    [policies, policyIds],
  );

  // Resolve selected policy objects
  const selectedPolicies = useMemo(
    () => policyIds.map((id) => policies.find((p) => p.id === id)).filter(Boolean) as PolicyConfig[],
    [policyIds, policies],
  );

  const handleRemovePolicy = (id: string) => {
    setPolicyIds((prev) => prev.filter((pid) => pid !== id));
  };

  const handleCreateAndLink = useCallback((newPolicy: PolicyConfig) => {
    const updatedPolicies = [...policies, newPolicy];
    updateConfig.mutate(
      { policies: updatedPolicies },
      {
        onSuccess: () => {
          setPolicyIds((prev) => [...prev, newPolicy.id]);
          setCreatingPolicy(false);
        },
        onError: () => {
          setError('Failed to create policy. Please try again.');
        },
      },
    );
  }, [policies, updateConfig]);

  const handleSave = () => {
    onSave({
      name: name.trim(),
      value,
      policyIds: availability === 'policed' ? policyIds : [],
      scope: availability,
    });
  };

  const isValid = name.trim() && value.trim();
  const isEditing = !!initialData;

  const ACTION_LABEL: Record<string, string> = { allow: 'Allow', deny: 'Deny', approval: 'Approval' };
  const TARGET_LABEL: Record<string, string> = { command: 'Cmd', skill: 'Skill', url: 'URL' };

  return (
    <FormCard
      title={isEditing ? 'Edit Secret' : 'Add Secret'}
      onSave={handleSave}
      onCancel={onCancel}
      saving={saving}
      saveDisabled={!isValid}
      saveLabel={isEditing ? 'Update Secret' : 'Add Secret'}
      onFocusChange={onFocusChange}
      error={error}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Autocomplete
          freeSolo
          options={nameOptions}
          value={name}
          onChange={(_e, newValue) => setName(typeof newValue === 'string' ? newValue : '')}
          onInputChange={(_e, newInputValue) => setName(newInputValue)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Name"
              placeholder="e.g. DATABASE_URL"
              fullWidth
              helperText={
                nameOptions.length > 0
                  ? `${nameOptions.length} secret${nameOptions.length === 1 ? '' : 's'} detected in environment`
                  : undefined
              }
            />
          )}
        />
        <TextField
          label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          fullWidth
          type="password"
          placeholder={isEditing ? 'Re-enter secret value' : 'Enter secret value'}
        />

        {/* Availability toggle */}
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Availability
          </Typography>
          <RadioGroup
            row
            value={availability}
            onChange={(e) => {
              setAvailability(e.target.value as SecretScope);
              if (e.target.value !== 'policed') {
                setPolicyIds([]);
              }
            }}
          >
            <FormControlLabel value="standalone" control={<Radio size="small" />} label="Standalone" />
            <FormControlLabel value="global" control={<Radio size="small" />} label="Global" />
            <FormControlLabel value="policed" control={<Radio size="small" />} label="Policy-linked" />
          </RadioGroup>
        </Box>

        {/* Standalone info */}
        {availability === 'standalone' && (
          <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
            Stored securely but not injected into operations. Assign to global or a policy later.
          </Alert>
        )}

        {/* Global warning */}
        {availability === 'global' && (
          <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
            This secret will be available to ALL operations without restrictions.
            Consider linking to specific policies for better security.
          </Alert>
        )}

        {/* Policy-linked section */}
        {availability === 'policed' && (
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              Linked Policies
            </Typography>

            {selectedPolicies.length > 0 ? (
              <Box
                sx={(theme) => ({
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  mb: 1.5,
                })}
              >
                {selectedPolicies.map((p) => (
                  <Box
                    key={p.id}
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        size="small"
                        label={ACTION_LABEL[p.action]}
                        color={p.action === 'allow' ? 'success' : p.action === 'deny' ? 'error' : 'warning'}
                        variant="outlined"
                        sx={{ fontSize: 11, height: 20 }}
                      />
                      <Chip
                        size="small"
                        label={TARGET_LABEL[p.target]}
                        variant="outlined"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                      <Typography variant="body2">{p.name}</Typography>
                    </Box>
                    <IconButton size="small" onClick={() => handleRemovePolicy(p.id)}>
                      <X size={14} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                No policies linked yet.
              </Typography>
            )}

            {/* Policy selector + create button */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Autocomplete
                options={availablePolicies}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => (
                  <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="body2">{option.name}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Chip
                        size="small"
                        label={ACTION_LABEL[option.action]}
                        color={option.action === 'allow' ? 'success' : option.action === 'deny' ? 'error' : 'warning'}
                        variant="outlined"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                      <Chip
                        size="small"
                        label={TARGET_LABEL[option.target]}
                        variant="outlined"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                    </Box>
                  </Box>
                )}
                onChange={(_e, val) => {
                  if (val) {
                    setPolicyIds((prev) => [...prev, val.id]);
                  }
                }}
                value={null}
                blurOnSelect
                clearOnBlur
                size="small"
                sx={{ flex: 1 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder="Search policies..."
                    size="small"
                  />
                )}
              />
              <SecondaryButton
                size="small"
                onClick={() => setCreatingPolicy(!creatingPolicy)}
                sx={{ whiteSpace: 'nowrap', height: 40 }}
                startIcon={<Plus size={14} />}
              >
                Create Policy
              </SecondaryButton>
            </Box>
          </Box>
        )}

        {/* Inline Policy Creation — reuses PolicyEditor */}
        <Collapse in={creatingPolicy && availability === 'policed'} unmountOnExit timeout={200}>
          <PolicyEditor
            policy={null}
            hideSecrets
            title="Create Policy"
            saveLabel="Create & Link"
            saving={updateConfig.isPending}
            onSave={(newPolicy) => handleCreateAndLink(newPolicy)}
            onCancel={() => setCreatingPolicy(false)}
          />
        </Collapse>
      </Box>
    </FormCard>
  );
}

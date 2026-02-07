/**
 * Step 5: Migration Selection — let user choose which skills and env vars to migrate
 *
 * Shows the scan result from scan-source and lets the user select
 * which skills and environment variables to bring into AgenShield.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, Checkbox, FormControlLabel, FormGroup,
  Alert, Chip, Divider, Button, Collapse,
} from '@mui/material';
import { useSnapshot } from 'valtio';
import { Puzzle, KeyRound, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';

interface MigrationSelectStepProps {
  onConfirm: (selectedSkills: string[], selectedEnvVars: string[]) => void;
}

export function MigrationSelectStep({ onConfirm }: MigrationSelectStepProps) {
  const { scanResult } = useSnapshot(setupStore);

  // Initialize selection state — default all skills and all secret env vars selected
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => {
    if (!scanResult?.skills) return new Set();
    return new Set(scanResult.skills.map(s => s.name));
  });

  const [selectedEnvVars, setSelectedEnvVars] = useState<Set<string>>(() => {
    if (!scanResult?.envVars) return new Set();
    return new Set(scanResult.envVars.filter(e => e.isSecret).map(e => e.name));
  });

  const [showAllEnvVars, setShowAllEnvVars] = useState(false);

  const skills = scanResult?.skills ?? [];
  const envVars = scanResult?.envVars ?? [];

  const secretEnvVars = useMemo(() => envVars.filter(e => e.isSecret), [envVars]);
  const nonSecretEnvVars = useMemo(() => envVars.filter(e => !e.isSecret), [envVars]);

  const toggleSkill = useCallback((name: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleEnvVar = useCallback((name: string) => {
    setSelectedEnvVars(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAllSkills = useCallback(() => {
    setSelectedSkills(new Set(skills.map(s => s.name)));
  }, [skills]);

  const deselectAllSkills = useCallback(() => {
    setSelectedSkills(new Set());
  }, []);

  const selectAllEnvVars = useCallback(() => {
    setSelectedEnvVars(new Set(envVars.map(e => e.name)));
  }, [envVars]);

  const deselectAllEnvVars = useCallback(() => {
    setSelectedEnvVars(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm([...selectedSkills], [...selectedEnvVars]);
  }, [onConfirm, selectedSkills, selectedEnvVars]);

  const isEmpty = skills.length === 0 && envVars.length === 0;

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Select Migration Items
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>
        Choose which skills and secrets to bring into the AgenShield sandbox.
      </Typography>

      <Alert severity="info" icon={<Info size={18} />} sx={{ mb: 3 }}>
        Your original files will not be modified. AgenShield creates a clean copy.
      </Alert>

      {isEmpty && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          No skills or environment variables were found. You can continue with an empty migration.
        </Alert>
      )}

      {/* Skills section */}
      {skills.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Puzzle size={18} />
            <Typography variant="subtitle1" fontWeight={600}>
              Skills ({selectedSkills.size}/{skills.length})
            </Typography>
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
              <Button size="small" onClick={selectAllSkills} sx={{ textTransform: 'none', minWidth: 0 }}>
                All
              </Button>
              <Button size="small" onClick={deselectAllSkills} sx={{ textTransform: 'none', minWidth: 0 }}>
                None
              </Button>
            </Box>
          </Box>
          <FormGroup>
            {skills.map(skill => (
              <FormControlLabel
                key={skill.name}
                control={
                  <Checkbox
                    size="small"
                    checked={selectedSkills.has(skill.name)}
                    onChange={() => toggleSkill(skill.name)}
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{skill.name}</Typography>
                    {skill.enabled && <Chip label="enabled" size="small" color="success" variant="outlined" />}
                    {Object.keys(skill.envVars).length > 0 && (
                      <Chip
                        label={`${Object.keys(skill.envVars).length} vars`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                    {skill.description && (
                      <Typography variant="caption" color="text.secondary">
                        {skill.description}
                      </Typography>
                    )}
                  </Box>
                }
                sx={{ ml: 0, mb: 0.5 }}
              />
            ))}
          </FormGroup>
        </Box>
      )}

      {/* Env vars section */}
      {envVars.length > 0 && (
        <>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <KeyRound size={18} />
              <Typography variant="subtitle1" fontWeight={600}>
                Secrets ({selectedEnvVars.size}/{envVars.length})
              </Typography>
              <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                <Button size="small" onClick={selectAllEnvVars} sx={{ textTransform: 'none', minWidth: 0 }}>
                  All
                </Button>
                <Button size="small" onClick={deselectAllEnvVars} sx={{ textTransform: 'none', minWidth: 0 }}>
                  None
                </Button>
              </Box>
            </Box>

            {/* Secret env vars (always shown) */}
            <FormGroup>
              {secretEnvVars.map(envVar => (
                <FormControlLabel
                  key={envVar.name}
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedEnvVars.has(envVar.name)}
                      onChange={() => toggleEnvVar(envVar.name)}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontFamily="monospace" fontSize={13}>
                        {envVar.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {envVar.maskedValue}
                      </Typography>
                      <Chip label={envVar.source} size="small" variant="outlined" />
                    </Box>
                  }
                  sx={{ ml: 0, mb: 0.5 }}
                />
              ))}
            </FormGroup>

            {/* Non-secret env vars (collapsible) */}
            {nonSecretEnvVars.length > 0 && (
              <>
                <Button
                  size="small"
                  onClick={() => setShowAllEnvVars(!showAllEnvVars)}
                  startIcon={showAllEnvVars ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  sx={{ textTransform: 'none', mt: 1 }}
                >
                  {showAllEnvVars ? 'Hide' : 'Show'} {nonSecretEnvVars.length} non-secret variables
                </Button>
                <Collapse in={showAllEnvVars}>
                  <FormGroup sx={{ mt: 1 }}>
                    {nonSecretEnvVars.map(envVar => (
                      <FormControlLabel
                        key={envVar.name}
                        control={
                          <Checkbox
                            size="small"
                            checked={selectedEnvVars.has(envVar.name)}
                            onChange={() => toggleEnvVar(envVar.name)}
                          />
                        }
                        label={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" fontFamily="monospace" fontSize={13}>
                              {envVar.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {envVar.maskedValue}
                            </Typography>
                            <Chip label={envVar.source} size="small" variant="outlined" />
                          </Box>
                        }
                        sx={{ ml: 0, mb: 0.5 }}
                      />
                    ))}
                  </FormGroup>
                </Collapse>
              </>
            )}
          </Box>
        </>
      )}

      {/* Warnings */}
      {scanResult?.warnings && scanResult.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {scanResult.warnings.map((w, i) => (
            <Typography key={i} variant="body2">{w}</Typography>
          ))}
        </Alert>
      )}

      <Button
        variant="contained"
        size="large"
        onClick={handleConfirm}
        sx={{ mt: 1 }}
      >
        {isEmpty ? 'Continue' : `Migrate ${selectedSkills.size} skill${selectedSkills.size !== 1 ? 's' : ''} and ${selectedEnvVars.size} secret${selectedEnvVars.size !== 1 ? 's' : ''}`}
      </Button>
    </Box>
  );
}

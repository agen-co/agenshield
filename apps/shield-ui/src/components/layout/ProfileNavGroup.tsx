/**
 * Collapsible profile section in the sidebar — enriched with brand logo,
 * username, and policy/secret counts.
 */

import { Box, ListItem, ListItemIcon, ListItemText, Collapse, Chip, Typography } from '@mui/material';
import { ChevronRight, ShieldCheck, Zap, KeyRound, Variable } from 'lucide-react';
import { getBrandIcon, getTargetIcon } from '../../utils/targetBranding';
import { ProfileGroupHeader, ProfileSubNav, NavButton } from './Sidebar.styles';

const SUB_ITEMS = [
  { path: 'policies', label: 'Policies', icon: ShieldCheck },
  { path: 'skills', label: 'Skills', icon: Zap },
  { path: 'secrets', label: 'Secrets', icon: KeyRound },
  { path: 'env', label: 'Env Vars', icon: Variable },
] as const;

interface ProfileNavGroupProps {
  profile: {
    id: string;
    name: string;
    presetId?: string;
    type?: string;
    agentUsername?: string;
    policiesCount?: number;
    secretsCount?: number;
  };
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  currentPath: string;
}

export function ProfileNavGroup({ profile, expanded, onToggle, onNavigate, currentPath }: ProfileNavGroupProps) {
  const basePath = `/profiles/${profile.id}`;
  const brandIcon = getBrandIcon(profile.presetId ?? profile.type ?? '');
  const FallbackIcon = getTargetIcon(profile.presetId ?? profile.type ?? '');

  return (
    <>
      <ListItem disablePadding sx={{ mb: 0.25, px: 1.5 }}>
        <ProfileGroupHeader onClick={onToggle}>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <ChevronRight
              size={14}
              style={{
                transition: 'transform 150ms ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
          </ListItemIcon>

          {/* Brand logo or fallback icon */}
          <Box sx={{ display: 'flex', alignItems: 'center', mr: 1, flexShrink: 0 }}>
            {brandIcon ? (
              <img src={brandIcon} alt="" style={{ width: 18, height: 18 }} />
            ) : (
              <FallbackIcon size={16} />
            )}
          </Box>

          {/* Name + username */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <ListItemText
              primary={profile.name}
              primaryTypographyProps={{ variant: 'subtitle2', noWrap: true, fontWeight: 600 }}
              sx={{ m: 0 }}
            />
            {profile.agentUsername && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.2, fontSize: '0.65rem' }}>
                {profile.agentUsername}
              </Typography>
            )}
          </Box>

          {/* Count badges */}
          <Box sx={{ display: 'flex', gap: 0.5, ml: 0.5, flexShrink: 0 }}>
            {(profile.policiesCount ?? 0) > 0 && (
              <Chip
                label={profile.policiesCount}
                size="small"
                sx={{ height: 18, minWidth: 18, fontSize: '0.6rem', fontWeight: 700, '& .MuiChip-label': { px: 0.5 } }}
              />
            )}
            {(profile.secretsCount ?? 0) > 0 && (
              <Chip
                label={profile.secretsCount}
                size="small"
                icon={<KeyRound size={9} />}
                sx={{ height: 18, minWidth: 18, fontSize: '0.6rem', fontWeight: 700, '& .MuiChip-label': { px: 0.5 }, '& .MuiChip-icon': { ml: 0.25, mr: -0.25 } }}
              />
            )}
          </Box>
        </ProfileGroupHeader>
      </ListItem>

      <Collapse in={expanded} unmountOnExit>
        <ProfileSubNav disablePadding>
          {SUB_ITEMS.map(({ path, label, icon: Icon }) => {
            const fullPath = `${basePath}/${path}`;
            const isSelected = currentPath.startsWith(fullPath);

            return (
              <ListItem key={path} disablePadding sx={{ mb: 0.25, px: 1.5 }}>
                <NavButton
                  $selected={isSelected}
                  onClick={() => onNavigate(fullPath)}
                >
                  <ListItemIcon sx={{ minWidth: 26 }}>
                    <Icon size={14} />
                  </ListItemIcon>
                  <ListItemText
                    primary={label}
                    primaryTypographyProps={{ variant: 'body2' }}
                  />
                </NavButton>
              </ListItem>
            );
          })}
        </ProfileSubNav>
      </Collapse>
    </>
  );
}

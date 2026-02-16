/**
 * Collapsible profile section in the sidebar
 */

import { ListItem, ListItemIcon, ListItemText, Collapse } from '@mui/material';
import { ChevronRight, ShieldCheck, Zap, KeyRound, Variable } from 'lucide-react';
import { ProfileGroupHeader, ProfileSubNav, NavButton } from './Sidebar.styles';

const SUB_ITEMS = [
  { path: 'policies', label: 'Policies', icon: ShieldCheck },
  { path: 'skills', label: 'Skills', icon: Zap },
  { path: 'secrets', label: 'Secrets', icon: KeyRound },
  { path: 'env', label: 'Env Vars', icon: Variable },
] as const;

interface ProfileNavGroupProps {
  profile: { id: string; name: string };
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  currentPath: string;
}

export function ProfileNavGroup({ profile, expanded, onToggle, onNavigate, currentPath }: ProfileNavGroupProps) {
  const basePath = `/profiles/${profile.id}`;

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
          <ListItemText
            primary={profile.name}
            primaryTypographyProps={{ variant: 'subtitle2', noWrap: true }}
          />
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

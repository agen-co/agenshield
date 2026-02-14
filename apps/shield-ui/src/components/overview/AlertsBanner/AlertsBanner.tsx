/**
 * AlertsBanner — Persistent alert acknowledgement banner for Overview page
 *
 * Shows unacknowledged alerts with severity indicators, navigation buttons,
 * and dismiss actions. Collapses when no alerts are present.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  Button,
  IconButton,
  Chip,
  Collapse,
  Tooltip,
  useTheme,
} from '@mui/material';
import {
  ShieldAlert,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
} from 'lucide-react';
import type { Alert, AlertSeverity } from '@agenshield/ipc';
import { useAlerts, useAcknowledgeAlert, useAcknowledgeAllAlerts } from '../../../api/hooks';
import { useAuth } from '../../../context/AuthContext';
import { slideIn } from '../../../styles/animations';
import type { AlertsBannerProps } from './AlertsBanner.types';
import {
  BannerCard,
  BannerHeader,
  AlertList,
  AlertItem,
  AlertContent,
  AlertActions,
} from './AlertsBanner.styles';

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function getSeverityIcon(severity: AlertSeverity, size = 16) {
  switch (severity) {
    case 'critical':
      return <ShieldAlert size={size} />;
    case 'warning':
      return <AlertTriangle size={size} />;
    case 'info':
      return <Info size={size} />;
  }
}

function useSeverityColor(severity: AlertSeverity) {
  const theme = useTheme();
  switch (severity) {
    case 'critical':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'info':
      return theme.palette.info.main;
  }
}

export function AlertsBanner({ animationDelay = 50 }: AlertsBannerProps) {
  const navigate = useNavigate();
  const theme = useTheme();
  const { isReadOnly } = useAuth();
  const { data } = useAlerts();
  const acknowledgeAlert = useAcknowledgeAlert();
  const acknowledgeAll = useAcknowledgeAllAlerts();
  const [expanded, setExpanded] = useState(false);

  const alerts = data?.data ?? [];
  const unacknowledgedCount = data?.meta?.unacknowledgedCount ?? 0;

  // Don't render if no alerts
  if (alerts.length === 0) return null;

  // Sort by severity
  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity as AlertSeverity] - SEVERITY_ORDER[b.severity as AlertSeverity],
  );
  const highestSeverity = sorted[0]?.severity as AlertSeverity;
  const borderColor = (() => {
    switch (highestSeverity) {
      case 'critical':
        return theme.palette.error.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'info':
        return theme.palette.info.main;
      default:
        return theme.palette.warning.main;
    }
  })();

  const handleDismiss = (id: number) => {
    acknowledgeAlert.mutate(id);
  };

  const handleDismissAll = () => {
    acknowledgeAll.mutate();
  };

  return (
    <Box sx={{ animation: `${slideIn} 0.4s ease-out ${animationDelay}ms both`, mt: 3 }}>
      <BannerCard variant="outlined" $borderColor={borderColor}>
        <BannerHeader onClick={() => setExpanded(!expanded)}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ color: borderColor, display: 'flex' }}>
              {getSeverityIcon(highestSeverity, 20)}
            </Box>
            <Chip
              label={unacknowledgedCount}
              size="small"
              sx={{
                bgcolor: borderColor,
                color: '#fff',
                fontWeight: 600,
                height: 22,
                minWidth: 22,
              }}
            />
            <Typography variant="subtitle2" noWrap>
              {sorted[0]?.title}
              {alerts.length > 1 && ` (+${alerts.length - 1} more)`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {!isReadOnly && alerts.length > 1 && (
              <Button
                size="small"
                variant="text"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismissAll();
                }}
                disabled={acknowledgeAll.isPending}
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
              >
                Dismiss All
              </Button>
            )}
            <IconButton size="small">
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </IconButton>
          </Box>
        </BannerHeader>

        <Collapse in={expanded}>
          <AlertList>
            {sorted.map((alert) => (
              <AlertItemRow
                key={alert.id}
                alert={alert}
                isReadOnly={isReadOnly}
                onView={() => navigate(alert.navigationTarget)}
                onDismiss={() => handleDismiss(alert.id)}
                dismissing={acknowledgeAlert.isPending}
              />
            ))}
          </AlertList>
        </Collapse>
      </BannerCard>
    </Box>
  );
}

function AlertItemRow({
  alert,
  isReadOnly,
  onView,
  onDismiss,
  dismissing,
}: {
  alert: Alert;
  isReadOnly: boolean;
  onView: () => void;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const color = useSeverityColor(alert.severity as AlertSeverity);

  return (
    <AlertItem>
      <Box sx={{ color, display: 'flex', mt: 0.25 }}>
        {getSeverityIcon(alert.severity as AlertSeverity)}
      </Box>
      <AlertContent>
        <Typography variant="body2" fontWeight={600}>
          {alert.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {alert.description}
        </Typography>
      </AlertContent>
      <AlertActions>
        <Tooltip title="View details">
          <IconButton size="small" onClick={onView}>
            <ExternalLink size={14} />
          </IconButton>
        </Tooltip>
        {!isReadOnly && (
          <Tooltip title="Dismiss">
            <IconButton size="small" onClick={onDismiss} disabled={dismissing}>
              <X size={14} />
            </IconButton>
          </Tooltip>
        )}
      </AlertActions>
    </AlertItem>
  );
}

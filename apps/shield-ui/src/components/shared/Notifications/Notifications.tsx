import { useSnapshot } from 'valtio';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import { useTheme } from '@mui/material/styles';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { notificationStore, dismiss } from '../../../stores/notifications';
import type { NotificationSeverity } from '../../../stores/notifications';
import { Stack, ToastCard } from './Notifications.styles';
import type { NotificationsProps } from './Notifications.types';

const severityIcon: Record<NotificationSeverity, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const severityColorKey: Record<NotificationSeverity, 'success' | 'error' | 'warning' | 'info'> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

export function Notifications({ maxVisible = 5 }: NotificationsProps) {
  const { notifications } = useSnapshot(notificationStore);
  const theme = useTheme();

  if (notifications.length === 0) return null;

  const visible = notifications.slice(-maxVisible);

  return (
    <Stack>
      {visible.map((n) => {
        const Icon = severityIcon[n.severity];
        const color = theme.palette[severityColorKey[n.severity]].main;
        const bg = theme.palette.mode === 'dark'
          ? theme.palette.background.paper
          : theme.palette.background.paper;

        return (
          <ToastCard
            key={n.id}
            sx={{
              backgroundColor: bg,
              borderLeft: `3px solid ${color}`,
            }}
          >
            <Icon size={18} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
                {n.message}
              </Typography>
              {n.action && (
                <Button
                  size="small"
                  onClick={n.action.onClick}
                  sx={{
                    mt: 0.5,
                    p: 0,
                    minWidth: 0,
                    textTransform: 'unset',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color,
                  }}
                >
                  {n.action.label}
                </Button>
              )}
            </div>
            <IconButton
              size="small"
              onClick={() => dismiss(n.id)}
              sx={{ mt: -0.5, mr: -0.5, opacity: 0.5, '&:hover': { opacity: 1 } }}
            >
              <X size={14} />
            </IconButton>
          </ToastCard>
        );
      })}
    </Stack>
  );
}

import {
  Activity,
  Clock,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { StatCard } from '../../shared/Card';
import { Root } from './StatsRow.styles';
import type { GetStatusResponse, GetConfigResponse } from '@agenshield/ipc';
import type { SecurityStatus } from '../../../api/client';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '< 1m';
}

interface StatsRowProps {
  status?: GetStatusResponse;
  config?: GetConfigResponse;
  security?: { data: SecurityStatus };
  statusLoading: boolean;
  configLoading: boolean;
}

export function StatsRow({ status, config, security, statusLoading, configLoading }: StatsRowProps) {
  const theme = useTheme();
  const daemonStatus = status?.data;
  const shieldConfig = config?.data;

  return (
    <Root>
      <StatCard
        title="Status"
        value={daemonStatus?.running ? 'Running' : 'Stopped'}
        icon={<Activity size={20} />}
        color={daemonStatus?.running ? theme.palette.success.main : theme.palette.error.main}
        loading={statusLoading}
      />
      <StatCard
        title="Uptime"
        value={daemonStatus?.uptime ? formatUptime(daemonStatus.uptime) : '-'}
        icon={<Clock size={20} />}
        loading={statusLoading}
      />
      <StatCard
        title="Process ID"
        value={daemonStatus?.pid ?? '-'}
        icon={<Cpu size={20} />}
        loading={statusLoading}
      />
      <StatCard
        title="Active Policies"
        value={shieldConfig?.policies?.filter((p) => p.enabled).length ?? 0}
        icon={<ShieldCheck size={20} />}
        color={theme.palette.secondary.main}
        loading={configLoading}
      />
      <StatCard
        title="Security Level"
        value={security?.data?.level ? security.data.level.charAt(0).toUpperCase() + security.data.level.slice(1) : '-'}
        icon={<ShieldAlert size={20} />}
        color={
          security?.data?.level === 'high'
            ? theme.palette.success.main
            : security?.data?.level === 'medium'
              ? theme.palette.warning.main
              : theme.palette.error.main
        }
        loading={!security}
      />
      <StatCard
        title="Requests Today"
        value={security?.data?.totalRequests ?? 0}
        icon={<BarChart3 size={20} />}
        loading={!security}
      />
    </Root>
  );
}

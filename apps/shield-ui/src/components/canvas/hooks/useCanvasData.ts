/**
 * Aggregates all data sources into a single CanvasData object for the canvas dashboard
 */

import { useMemo } from 'react';
import { useSnapshot } from 'valtio';
import { useStatus, useHealth, useAgenCoStatus, useSecurity, useProfiles } from '../../../api/hooks';
import { useAuth } from '../../../context/AuthContext';
import { eventStore } from '../../../state/events';
import { daemonStatusStore } from '../../../state/daemon-status';
import { isNoiseEvent, BLOCKED_EVENT_TYPES } from '../../../utils/eventDisplay';
import type { CanvasData, TargetWithCounts } from '../Canvas.types';
import { formatDistanceToNow } from 'date-fns';

export function useCanvasData(): CanvasData {
  const { data: healthData } = useHealth();
  const { data: statusData } = useStatus();
  const { data: profilesData } = useProfiles();
  const { data: agencoData } = useAgenCoStatus();
  const { data: securityData } = useSecurity();
  const { protectionEnabled } = useAuth();
  const { events, connected: sseConnected } = useSnapshot(eventStore);
  const { status: daemonStatus } = useSnapshot(daemonStatusStore);

  const recentEvents = useMemo(
    () => events.filter((e) => !isNoiseEvent(e)).slice(0, 20),
    [events],
  );

  const targets = useMemo((): TargetWithCounts[] => {
    const profiles = profilesData?.data;
    if (!profiles || !Array.isArray(profiles)) return [];

    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type ?? 'target',
      shielded: true,
      users: [],
      skillCount: 0,
      policyCount: 0,
      secretCount: 0,
    }));
  }, [profilesData]);

  const eventCounts = useMemo(() => {
    let denied = 0;
    let allowed = 0;
    for (const e of events.slice(0, 200)) {
      if (BLOCKED_EVENT_TYPES.has(e.type)) {
        denied++;
      } else if (e.type === 'interceptor:event') {
        const d = e.data as Record<string, unknown>;
        const dtype = String(d.type ?? '');
        if (dtype === 'denied' || dtype === 'deny') denied++;
        else allowed++;
      } else {
        allowed++;
      }
    }
    return { total: denied + allowed, denied, allowed };
  }, [events]);

  const warningCount = securityData?.data?.warnings?.length ?? 0;
  const criticalCount = securityData?.data?.critical?.length ?? 0;

  const coreStatus = useMemo((): CanvasData['coreStatus'] => {
    if (!healthData) return 'error';
    if (criticalCount > 0) return 'error';
    if (warningCount > 0) return 'warning';
    return 'ok';
  }, [healthData, warningCount, criticalCount]);

  const daemonRunning = Boolean(daemonStatus?.running ?? healthData?.data);
  const daemonVersion = String(daemonStatus?.version ?? '0.1.0');
  const daemonPid = typeof daemonStatus?.pid === 'number' ? daemonStatus.pid : undefined;

  const daemonUptime = useMemo(() => {
    const startedAt = daemonStatus?.startedAt;
    if (typeof startedAt === 'number' && startedAt > 0) {
      return formatDistanceToNow(startedAt);
    }
    return 'N/A';
  }, [daemonStatus]);

  const cloudConnected = Boolean(agencoData?.data?.authenticated);

  const sandboxUserExists = Boolean(securityData?.data?.sandboxUserExists);
  const isIsolated = Boolean(securityData?.data?.isIsolated);
  const guardedShellInstalled = Boolean(securityData?.data?.guardedShellInstalled);
  const currentUser = String(securityData?.data?.currentUser ?? 'Unknown');
  const securityLevel = (securityData?.data?.level ?? 'unprotected') as CanvasData['securityLevel'];

  return {
    targets,
    coreStatus,
    daemonRunning,
    daemonVersion,
    daemonUptime,
    daemonPid,
    cloudConnected,
    sseConnected,
    authLocked: protectionEnabled,
    recentEvents,
    totalEvents: eventCounts.total,
    deniedEvents: eventCounts.denied,
    allowedEvents: eventCounts.allowed,
    warningCount,
    sandboxUserExists,
    isIsolated,
    guardedShellInstalled,
    securityLevel,
    currentUser,
  };
}

/**
 * iCloud backup/restore routes
 *
 * macOS only. All routes return appropriate errors on non-macOS platforms.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@agenshield/ipc';
import {
  detectICloudBackup,
  performICloudBackup,
  restoreFromICloud,
} from '../services/icloud-backup';

export async function icloudRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /icloud/status — Check iCloud availability and backup detection.
   */
  app.get('/icloud/status', async (): Promise<ApiResponse<{
    platform: string;
    available: boolean;
    backupFound: boolean;
    backupPath?: string;
    backupDate?: string;
    files?: string[];
  }>> => {
    if (process.platform !== 'darwin') {
      return {
        success: true,
        data: {
          platform: process.platform,
          available: false,
          backupFound: false,
        },
      };
    }

    const result = detectICloudBackup();
    return {
      success: true,
      data: {
        platform: process.platform,
        available: true,
        backupFound: result.backupFound ?? false,
        backupPath: result.backupPath,
        backupDate: result.backupDate,
        files: result.files,
      },
    };
  });

  /**
   * GET /icloud/detect — Alias for status, specifically for restore-on-install flow.
   */
  app.get('/icloud/detect', async (): Promise<ApiResponse<{
    backupFound: boolean;
    backupPath?: string;
    backupDate?: string;
  }>> => {
    if (process.platform !== 'darwin') {
      return { success: true, data: { backupFound: false } };
    }

    const result = detectICloudBackup();
    return {
      success: true,
      data: {
        backupFound: result.backupFound ?? false,
        backupPath: result.backupPath,
        backupDate: result.backupDate,
      },
    };
  });

  /**
   * POST /icloud/backup — Trigger a manual iCloud backup.
   */
  app.post('/icloud/backup', async (): Promise<ApiResponse<{
    filesBackedUp: number;
    files?: string[];
  }>> => {
    if (process.platform !== 'darwin') {
      return {
        success: false,
        error: {
          code: 'PLATFORM_UNSUPPORTED',
          message: 'iCloud backup is only available on macOS',
        },
      };
    }

    const result = performICloudBackup();
    if (!result.success) {
      return {
        success: false,
        error: {
          code: 'ICLOUD_BACKUP_FAILED',
          message: result.error ?? 'Backup failed',
        },
      };
    }

    return {
      success: true,
      data: {
        filesBackedUp: result.files?.length ?? 0,
        files: result.files,
      },
    };
  });

  /**
   * POST /icloud/restore — Restore from iCloud backup.
   * The daemon should be restarted after restore.
   */
  app.post('/icloud/restore', async (): Promise<ApiResponse<{
    filesRestored: number;
    files?: string[];
    restartRequired: boolean;
  }>> => {
    if (process.platform !== 'darwin') {
      return {
        success: false,
        error: {
          code: 'PLATFORM_UNSUPPORTED',
          message: 'iCloud restore is only available on macOS',
        },
      };
    }

    const result = restoreFromICloud();
    if (!result.success) {
      return {
        success: false,
        error: {
          code: 'ICLOUD_RESTORE_FAILED',
          message: result.error ?? 'Restore failed',
        },
      };
    }

    return {
      success: true,
      data: {
        filesRestored: result.files?.length ?? 0,
        files: result.files,
        restartRequired: true,
      },
    };
  });
}

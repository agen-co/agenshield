/**
 * Enrollment route
 *
 * Exposes the current enrollment state so the UI/CLI can show
 * the device code and verification URL to the user.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@agenshield/ipc';
import { getEnrollmentService, type EnrollmentState } from '../services/enrollment';

export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/enrollment/status', async (): Promise<ApiResponse<EnrollmentState>> => {
    const state = getEnrollmentService().getState();
    return {
      success: true,
      data: state,
    };
  });
}

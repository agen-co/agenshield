/**
 * Tests for role definitions and permission checks
 */

import {
  hasMinimumRole,
  isPublicRoute,
  isAdminOnlyRoute,
} from '../roles';

describe('Roles', () => {
  describe('hasMinimumRole', () => {
    it('admin should satisfy admin requirement', () => {
      expect(hasMinimumRole('admin', 'admin')).toBe(true);
    });

    it('admin should satisfy broker requirement', () => {
      expect(hasMinimumRole('admin', 'broker')).toBe(true);
    });

    it('broker should satisfy broker requirement', () => {
      expect(hasMinimumRole('broker', 'broker')).toBe(true);
    });

    it('broker should NOT satisfy admin requirement', () => {
      expect(hasMinimumRole('broker', 'admin')).toBe(false);
    });
  });

  describe('isPublicRoute', () => {
    it('should recognize health route as public', () => {
      expect(isPublicRoute('/api/health')).toBe(true);
    });

    it('should recognize auth status as public', () => {
      expect(isPublicRoute('/api/auth/status')).toBe(true);
    });

    it('should recognize sudo-login as public', () => {
      expect(isPublicRoute('/api/auth/sudo-login')).toBe(true);
    });

    it('should recognize workspace-paths/check as public', () => {
      expect(isPublicRoute('/api/workspace-paths/check')).toBe(true);
    });

    it('should recognize workspace-paths/grant as public', () => {
      expect(isPublicRoute('/api/workspace-paths/grant')).toBe(true);
    });

    it('should recognize workspace-paths/fix-permissions as public', () => {
      expect(isPublicRoute('/api/workspace-paths/fix-permissions')).toBe(true);
    });

    it('should NOT consider config route as public', () => {
      expect(isPublicRoute('/api/config')).toBe(false);
    });
  });

  describe('isAdminOnlyRoute', () => {
    it('should recognize PUT /api/config as admin-only', () => {
      expect(isAdminOnlyRoute('PUT', '/api/config')).toBe(true);
    });

    it('should recognize POST /api/secrets as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/secrets')).toBe(true);
    });

    it('should NOT consider GET /api/config as admin-only', () => {
      expect(isAdminOnlyRoute('GET', '/api/config')).toBe(false);
    });

    it('should NOT consider GET /api/health as admin-only', () => {
      expect(isAdminOnlyRoute('GET', '/api/health')).toBe(false);
    });

    // Wildcard skill mutation routes
    it('should recognize POST /api/skills/my-plugin/install as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/skills/my-plugin/install')).toBe(true);
    });

    it('should recognize POST /api/skills/my-plugin/approve as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/skills/my-plugin/approve')).toBe(true);
    });

    it('should recognize DELETE /api/skills/my-plugin as admin-only', () => {
      expect(isAdminOnlyRoute('DELETE', '/api/skills/my-plugin')).toBe(true);
    });

    it('should recognize PUT /api/skills/my-plugin/toggle as admin-only', () => {
      expect(isAdminOnlyRoute('PUT', '/api/skills/my-plugin/toggle')).toBe(true);
    });

    it('should recognize POST /api/skills/my-plugin/unblock as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/skills/my-plugin/unblock')).toBe(true);
    });

    it('should recognize POST /api/skills/my-plugin/analyze as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/skills/my-plugin/analyze')).toBe(true);
    });

    it('should recognize POST /api/skills/my-plugin/revoke as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/skills/my-plugin/revoke')).toBe(true);
    });

    // Marketplace mutation routes
    it('should recognize POST /api/marketplace/download as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/marketplace/download')).toBe(true);
    });

    it('should recognize POST /api/marketplace/install as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/marketplace/install')).toBe(true);
    });

    it('should recognize POST /api/marketplace/analyze as admin-only', () => {
      expect(isAdminOnlyRoute('POST', '/api/marketplace/analyze')).toBe(true);
    });

    // Non-admin routes
    it('should NOT consider GET /api/skills as admin-only', () => {
      expect(isAdminOnlyRoute('GET', '/api/skills')).toBe(false);
    });

    it('should NOT consider GET /api/skills/my-plugin as admin-only', () => {
      expect(isAdminOnlyRoute('GET', '/api/skills/my-plugin')).toBe(false);
    });

    it('should NOT consider GET /api/marketplace/search as admin-only', () => {
      expect(isAdminOnlyRoute('GET', '/api/marketplace/search')).toBe(false);
    });

    // Wildcard should not match extra path segments
    it('should NOT match DELETE /api/skills/my-plugin/extra/path', () => {
      expect(isAdminOnlyRoute('DELETE', '/api/skills/my-plugin/extra/path')).toBe(false);
    });
  });
});

/**
 * Session manager
 *
 * Manages authentication sessions with in-memory storage.
 * Sessions are cleared on daemon restart.
 * Includes idle-timeout auto-lock: after `autoLockTimeoutMs` of inactivity
 * (no API requests), the vault is locked and all sessions are cleared.
 */

import * as crypto from 'node:crypto';
import type { Session } from '@agenshield/ipc';
import { DEFAULT_AUTH_CONFIG } from '@agenshield/ipc';

/**
 * Session manager class
 */
class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionTtlMs: number;
  private autoLockTimeoutMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoLockHandler?: () => void;

  constructor(
    sessionTtlMs: number = DEFAULT_AUTH_CONFIG.sessionTtlMs,
    autoLockTimeoutMs: number = DEFAULT_AUTH_CONFIG.autoLockTimeoutMs,
  ) {
    this.sessionTtlMs = sessionTtlMs;
    this.autoLockTimeoutMs = autoLockTimeoutMs;
    this.startCleanup();
  }

  /**
   * Register a callback invoked when the idle timer fires.
   * The callback should lock storage, clear broker secrets, and emit the SSE event.
   */
  setAutoLockHandler(handler: () => void): void {
    this.onAutoLockHandler = handler;
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    // 32 bytes = 256 bits of entropy, base64url encoded
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Create a new session
   */
  createSession(clientId?: string): Session {
    const token = this.generateToken();
    const now = Date.now();

    const session: Session = {
      token,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      clientId,
    };

    this.sessions.set(token, session);
    this.resetIdleTimer();
    return session;
  }

  /**
   * Validate a session token
   * Returns the session if valid, undefined if invalid or expired
   */
  validateSession(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (!session) {
      return undefined;
    }

    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }

    return session;
  }

  /**
   * Invalidate a session
   */
  invalidateSession(token: string): boolean {
    return this.sessions.delete(token);
  }

  /**
   * Refresh a session's expiration time
   */
  refreshSession(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (!session) {
      return undefined;
    }

    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }

    session.expiresAt = Date.now() + this.sessionTtlMs;
    this.sessions.set(token, session);
    return session;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    const now = Date.now();
    const active: Session[] = [];

    for (const session of this.sessions.values()) {
      if (session.expiresAt > now) {
        active.push(session);
      }
    }

    return active;
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.clearIdleTimer();
  }

  /**
   * Record API activity to reset the idle auto-lock timer.
   * Call this on every non-SSE API request.
   */
  touchActivity(): void {
    if (this.getActiveSessions().length > 0) {
      this.resetIdleTimer();
    }
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanup(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearIdleTimer();
  }

  /**
   * Remove expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
    // If all sessions expired, auto-lock
    if (this.sessions.size === 0 && this.idleTimer) {
      this.clearIdleTimer();
      this.onAutoLockHandler?.();
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  // ---- Idle auto-lock ----

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.getActiveSessions().length === 0) return;

    this.idleTimer = setTimeout(() => {
      this.autoLock();
    }, this.autoLockTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private autoLock(): void {
    if (this.sessions.size === 0) return;
    this.clearAllSessions();
    this.onAutoLockHandler?.();
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

/**
 * Get the singleton session manager instance
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

/**
 * Reset the session manager singleton (for testing)
 */
export function resetSessionManager(): void {
  if (sessionManagerInstance) {
    sessionManagerInstance.stopCleanup();
    sessionManagerInstance.clearAllSessions();
  }
  sessionManagerInstance = null;
}

export { SessionManager };

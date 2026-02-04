/**
 * Session manager
 *
 * Manages authentication sessions with in-memory storage.
 * Sessions are cleared on daemon restart.
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
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sessionTtlMs: number = DEFAULT_AUTH_CONFIG.sessionTtlMs) {
    this.sessionTtlMs = sessionTtlMs;
    this.startCleanup();
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
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
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

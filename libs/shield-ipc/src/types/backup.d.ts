/**
 * Types for installation backup and restore
 */
/**
 * Information about the original OpenClaw installation
 */
export interface OriginalInstallation {
    /** Installation method */
    method: 'npm' | 'git';
    /** Path to the original package directory */
    packagePath: string;
    /** Path to the original binary */
    binaryPath?: string;
    /** Path to the original config directory */
    configPath?: string;
    /** Original config backup path (renamed to .backup-<timestamp>) */
    configBackupPath?: string;
    /** Installed version */
    version?: string;
    /** Path to the git repo (for git installs) */
    gitRepoPath?: string;
}
/**
 * Information about the sandbox user
 */
export interface SandboxUserInfo {
    /** Username (typically 'openclaw') */
    username: string;
    /** User ID */
    uid: number;
    /** Group ID */
    gid: number;
    /** Home directory */
    homeDir: string;
}
/**
 * Paths where files were migrated to
 */
export interface MigratedPaths {
    /** Path to the migrated package */
    packagePath: string;
    /** Path to the migrated config */
    configPath: string;
    /** Path to the new binary wrapper */
    binaryPath: string;
}
/**
 * Complete installation backup for safe reversal
 */
export interface InstallationBackup {
    /** Backup file format version */
    version: '1.0';
    /** Timestamp when backup was created (ISO 8601) */
    timestamp: string;
    /** Original user who ran the setup */
    originalUser: string;
    /** Original user's home directory */
    originalUserHome: string;
    /** Details about the original installation */
    originalInstallation: OriginalInstallation;
    /** Details about the sandbox user */
    sandboxUser: SandboxUserInfo;
    /** Paths where files were migrated */
    migratedPaths: MigratedPaths;
}
/**
 * Backup file location and permissions
 */
export declare const BACKUP_CONFIG: {
    /** Directory for AgenShield configuration */
    readonly configDir: "/etc/agenshield";
    /** Backup file path */
    readonly backupPath: "/etc/agenshield/backup.json";
    /** Directory permissions (readable by all, writable by root) */
    readonly dirMode: 493;
    /** File permissions (root only) */
    readonly fileMode: 384;
};
//# sourceMappingURL=backup.d.ts.map
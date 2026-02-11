/**
 * Types for the migration scan + selection flow
 *
 * Used by the preset scan system, wizard engine, setup server, and UI.
 * The scanning phase is strictly read-only — source files are never modified.
 */
/**
 * A skill discovered in the source application's config
 */
export interface ScannedSkill {
    /** Skill name/slug (key in the source config, e.g. openclaw.json skills.entries) */
    name: string;
    /** Whether the skill is enabled in the source config */
    enabled: boolean;
    /** Environment variables associated with this skill in source config */
    envVars: Record<string, string>;
    /** Path to the skill directory (if it exists on disk) */
    skillPath?: string;
    /** Whether the skill has a SKILL.md file */
    hasSkillMd: boolean;
    /** Human-readable description from SKILL.md metadata */
    description?: string;
}
/**
 * A discovered environment variable / secret
 */
export interface ScannedEnvVar {
    /** Variable name (e.g. OPENAI_API_KEY) */
    name: string;
    /** Masked value for display (e.g. "sk-...1234") */
    maskedValue: string;
    /** Where this env var was discovered */
    source: 'app-config' | 'process-env' | 'shell-profile';
    /** Which shell profile file it was found in (if source is shell-profile) */
    profilePath?: string;
    /** Whether it matches known secret patterns */
    isSecret: boolean;
    /** The skill name this env var is associated with (if from app config) */
    associatedSkill?: string;
}
/**
 * Complete result of scanning the source application
 */
export interface MigrationScanResult {
    /** Discovered skills */
    skills: ScannedSkill[];
    /** Discovered environment variables / secrets */
    envVars: ScannedEnvVar[];
    /** Source config path that was read */
    configPath?: string;
    /** Shell profile files that were scanned */
    scannedProfiles: string[];
    /** Timestamp of the scan */
    scannedAt: string;
    /** Any warnings during scanning */
    warnings: string[];
}
/**
 * User's selection of what to migrate
 */
export interface MigrationSelection {
    /** Skill names to migrate */
    selectedSkills: string[];
    /** Env var names to import into vault */
    selectedEnvVars: string[];
}
//# sourceMappingURL=migration.d.ts.map
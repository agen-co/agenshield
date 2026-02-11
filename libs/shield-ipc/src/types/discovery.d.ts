/**
 * Discovery types — shared across packages for binary/skill scanning
 */
import type { CommandCategory } from './catalog';
export type ExecutionContext = 'root' | 'user' | 'workspace';
export type BinarySourceKind = 'system' | 'homebrew' | 'npm-global' | 'yarn-global' | 'agent-bin' | 'workspace-bin' | 'path-other';
export type ProtectionKind = 'proxied' | 'wrapped' | 'allowed' | 'unprotected';
export interface DiscoveredBinary {
    name: string;
    path: string;
    dir: string;
    sourceKind: BinarySourceKind;
    contexts: ExecutionContext[];
    protection: ProtectionKind;
    category: CommandCategory;
    isShieldExecSymlink: boolean;
}
export interface BinaryDirectory {
    path: string;
    sourceKind: BinarySourceKind;
    contexts: ExecutionContext[];
    count: number;
}
export interface SkillMetadata {
    name?: string;
    description?: string;
    version?: string;
    homepage?: string;
    emoji?: string;
    'user-invocable'?: boolean;
    'disable-model-invocation'?: boolean;
    'command-dispatch'?: string;
    'command-tool'?: string;
    'command-arg-mode'?: string;
    requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
        [key: string]: unknown;
    };
    metadata?: {
        openclaw?: OpenClawSkillMetadata;
        [key: string]: unknown;
    };
    agenshield?: {
        allowedCommands?: string[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface OpenClawSkillMetadata {
    always?: boolean;
    os?: string[];
    requires?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
    };
    primaryEnv?: string;
    homepage?: string;
    install?: Array<{
        id: string;
        kind: string;
        formula?: string;
        bins?: string[];
    }>;
}
export interface SkillExtractedInfo {
    /** API keys / env vars required */
    apiKeys: string[];
    /** Binary dependencies */
    bins: string[];
    /** Optional binary alternatives */
    anyBins: string[];
    /** OpenClaw config paths required */
    configOptions: string[];
    /** Install instructions */
    installSteps: OpenClawSkillMetadata['install'];
}
export interface DiscoveredSkill {
    name: string;
    path: string;
    hasSkillMd: boolean;
    metadata: SkillMetadata | null;
    requiredCommands: SkillCommandRequirement[];
    approval: 'approved' | 'quarantined' | 'unknown';
    extractedInfo?: SkillExtractedInfo;
}
export interface SkillCommandRequirement {
    name: string;
    source: 'metadata' | 'analysis';
    available: boolean;
    resolvedPath?: string;
    protection?: ProtectionKind;
    required: boolean;
}
export interface DiscoveryOptions {
    agentHome?: string;
    workspaceDir?: string;
    scanSkills?: boolean;
    extraDirs?: string[];
}
export interface DiscoveryResult {
    scannedAt: string;
    binaries: DiscoveredBinary[];
    directories: BinaryDirectory[];
    skills: DiscoveredSkill[];
    summary: DiscoverySummary;
}
export interface DiscoverySummary {
    totalBinaries: number;
    totalDirectories: number;
    totalSkills: number;
    byContext: Record<ExecutionContext, number>;
    byProtection: Record<ProtectionKind, number>;
    bySourceKind: Partial<Record<BinarySourceKind, number>>;
    skillsWithMissingDeps: number;
}
//# sourceMappingURL=discovery.d.ts.map
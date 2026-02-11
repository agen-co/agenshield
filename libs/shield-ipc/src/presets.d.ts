/**
 * Policy Presets
 *
 * Predefined policy sets that provide sensible defaults for common use cases.
 * Seeded on first config creation.
 */
import type { PolicyConfig } from './types/config';
export interface PolicyPreset {
    id: string;
    name: string;
    description: string;
    policies: PolicyConfig[];
}
export declare const OPENCLAW_PRESET: PolicyPreset;
export declare const AGENCO_PRESET: PolicyPreset;
export declare const POLICY_PRESETS: PolicyPreset[];
//# sourceMappingURL=presets.d.ts.map
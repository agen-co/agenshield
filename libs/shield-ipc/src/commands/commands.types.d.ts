/**
 * Allowed command domain types
 *
 * Commands that are explicitly allowed by policy or user configuration.
 */
export interface AllowedCommand {
    name: string;
    paths: string[];
    addedAt: string;
    addedBy: string;
    category?: string;
}
//# sourceMappingURL=commands.types.d.ts.map
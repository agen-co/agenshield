/**
 * Command Catalog types — shared across packages
 */

export type SecurityRisk = 'high' | 'medium' | 'low' | 'info';
export type CommandCategory = 'system' | 'package-manager' | 'network' | 'shell' | 'language-runtime' | 'other';

export interface CatalogEntry {
  description: string;
  category: CommandCategory;
  risk: SecurityRisk;
  riskReason: string;
  tags: string[];
}

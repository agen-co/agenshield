/**
 * Marketplace types for skill browsing and installation
 */

export interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  installs: number;
  tags: string[];
  readme?: string;
  files?: MarketplaceSkillFile[];
}

export interface MarketplaceSkillFile {
  name: string;
  type: string;
  content: string;
  purpose?: string;
}

export interface AnalyzeSkillRequest {
  files: MarketplaceSkillFile[];
}

export interface AnalyzeSkillResponse {
  analysis: {
    status: 'complete' | 'error';
    vulnerability: {
      level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
      details: string[];
      suggestions?: string[];
    };
    commands: Array<{
      name: string;
      source: string;
      available: boolean;
      resolvedPath?: string;
      required: boolean;
    }>;
  };
}

export interface InstallSkillRequest {
  slug: string;
  files: MarketplaceSkillFile[];
  analysis: AnalyzeSkillResponse['analysis'];
}

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
  installed?: boolean;
  /** Pre-computed analysis returned from GET /marketplace/skills/:slug */
  analysis?: AnalyzeSkillResponse['analysis'];
  /** Status of analysis: pending (still running), complete, or error */
  analysisStatus?: 'pending' | 'complete' | 'error';
}

export interface MarketplaceSkillFile {
  name: string;
  type: string;
  content: string;
  purpose?: string;
}

export interface AnalyzeSkillRequest {
  skillName: string;
  publisher: string;
  files: MarketplaceSkillFile[];
}

export interface AnalyzeSkillFromSourceRequest {
  slug: string;
  source: 'clawhub';
  skillName?: string;
  publisher?: string;
}

export type AnalyzeSkillRequestUnion = AnalyzeSkillRequest | AnalyzeSkillFromSourceRequest;

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
  type?: string;
}

export type SkillsTab = 'active' | 'available' | 'blocked' | 'marketplace';

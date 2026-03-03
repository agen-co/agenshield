export interface PolicyOverviewProps {
  embedded?: boolean;
  onNavigate?: (key: string) => void;
}

export interface SectionCounts {
  allow: number;
  deny: number;
  disabled: number;
  total: number;
}

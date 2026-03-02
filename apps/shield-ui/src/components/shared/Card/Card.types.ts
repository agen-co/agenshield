export interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  loading?: boolean;
  /** Render as a compact single-line layout: [Icon] Title: Value */
  inline?: boolean;
}

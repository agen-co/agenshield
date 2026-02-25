export interface TargetOverviewProps {
  targetId: string;
  targetInfo?: {
    id: string;
    name: string;
    type: string;
    shielded: boolean;
    running: boolean;
    version?: string;
    binaryPath?: string;
    processes?: Array<{ pid: number; elapsed: string; command: string }>;
  };
  profileId?: string | null;
}

export interface InstallTargetDialogProps {
  open: boolean;
  skillName: string;
  skillSlug: string;
  existingInstallations?: Array<{ id: string; profileId?: string; status: string }>;
  onInstallToTarget: (targetId?: string) => Promise<void>;
  onUninstallFromTarget: (targetId?: string) => Promise<void>;
  onClose: () => void;
}

export interface InstallTargetDialogProps {
  open: boolean;
  skillName: string;
  skillSlug: string;
  existingInstallations?: Array<{ id: string; profileId?: string; status: string }>;
  onInstall: (targets: string[] | 'global') => Promise<void>;
  onCancel: () => void;
}

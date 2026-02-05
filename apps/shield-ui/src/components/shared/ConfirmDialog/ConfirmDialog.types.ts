export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  position?: 'top' | 'center';
  onConfirm: () => void;
  onCancel: () => void;
}

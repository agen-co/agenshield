import { forwardRef } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type DangerButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

export default forwardRef<HTMLButtonElement, DangerButtonProps>(function DangerButton(props, ref) {
  return <BaseButton variant="contained" color="error" ref={ref} {...props} />;
});

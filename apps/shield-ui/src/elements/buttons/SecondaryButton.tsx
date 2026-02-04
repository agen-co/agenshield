import { forwardRef } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type SecondaryButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

export default forwardRef<HTMLButtonElement, SecondaryButtonProps>(function SecondaryButton(props, ref) {
  return <BaseButton variant="outlined" color="secondary" ref={ref} {...props} />;
});

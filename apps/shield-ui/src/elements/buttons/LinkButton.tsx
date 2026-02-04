import { forwardRef } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type LinkButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

export default forwardRef<HTMLButtonElement, LinkButtonProps>(function LinkButton(props, ref) {
  return <BaseButton variant="text" color="primary" ref={ref} {...props} />;
});

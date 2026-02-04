import { forwardRef } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type IconButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

export default forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(props, ref) {
  return <BaseButton variant="text" color="secondary" iconOnly ref={ref} {...props} />;
});

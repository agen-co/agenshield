import { forwardRef } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type TextButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

export default forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(props, ref) {
  return <BaseButton variant="text" color="secondary" ref={ref} {...props} />;
});

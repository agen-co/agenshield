import { FC } from 'react';
import BaseButton, { BaseButtonProps } from './BaseButton';

export type PrimaryButtonProps = Omit<BaseButtonProps, 'color' | 'variant'>;

const PrimaryButton: FC<PrimaryButtonProps> = (props) => {
  return <BaseButton variant="contained" color="primary" {...props} />;
};

export default PrimaryButton;

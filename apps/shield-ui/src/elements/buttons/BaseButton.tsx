import Button, { ButtonProps } from '@mui/material/Button';
import { FC } from 'react';
import { CircularLoader } from '../loaders/CircularLoader';

export interface BaseButtonProps extends ButtonProps {
  iconOnly?: boolean;
  disableEffects?: boolean;
  loading?: boolean | null;
  children?: React.ReactNode;
}

const BaseButton: FC<BaseButtonProps> = (props) => {
  const { loading, iconOnly, disableEffects, disabled, className, startIcon, ...buttonProps } = props;
  const classNames = (className ?? '').split(' ');
  if (disableEffects) classNames.push('Mui-disableEffects');
  if (loading) classNames.push('Mui-loading');
  if (iconOnly) classNames.push('Mui-iconOnly');

  const customProps: Record<string, string> = {};
  if (iconOnly) customProps['fe-icon-only'] = 'true';
  if (disableEffects) customProps['fe-disable-effects'] = 'true';

  const generatedStartIcon = startIcon
    ? loading
      ? <CircularLoader disableShrink color="inherit" size="1rem" />
      : startIcon
    : undefined;

  return (
    <Button
      disabled={Boolean(disabled || loading)}
      className={classNames.join(' ')}
      startIcon={generatedStartIcon}
      {...buttonProps}
      {...customProps}
    >
      {!startIcon && loading ? (
        <>
          <CircularLoader disableShrink color="inherit" size="1rem" absolute />
          <span style={{ visibility: 'hidden' }}>{props.children}</span>
        </>
      ) : (
        props.children
      )}
    </Button>
  );
};

export default BaseButton;

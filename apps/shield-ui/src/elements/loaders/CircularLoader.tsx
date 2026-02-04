import { CSSProperties, forwardRef, useEffect, useState } from 'react';
import CircularProgress, { type CircularProgressProps } from '@mui/material/CircularProgress';

const useUniqueId = () => {
  const [uniqueId, setUniqueId] = useState('');
  useEffect(() => {
    setUniqueId(`id-${Math.random().toString(36).substring(2, 9)}`);
  }, []);
  return uniqueId;
};

export type CircularLoaderProps = CircularProgressProps & {
  absolute?: boolean;
};

export const CircularLoader = forwardRef<SVGElement, CircularLoaderProps>(
  function CircularLoader({ absolute, ...props }, ref) {
    const gradientId = useUniqueId();

    const style: CSSProperties = {};
    if (absolute) {
      style.width = '1rem';
      style.height = '1rem';
      style.position = 'absolute';
      style.left = 0;
      style.right = 0;
      style.top = 0;
      style.margin = 'auto';
      style.bottom = 0;
    }

    return (
      <>
        <svg width="0" height="0">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
              <stop offset="75%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        <CircularProgress
          ref={ref}
          disableShrink
          {...props}
          className={[props.className, 'MuiButton-loadingIcon'].join(' ')}
          sx={{
            ...props.sx,
            '& .MuiCircularProgress-circle': {
              stroke: `url(#${gradientId})`,
            },
          }}
          style={{ ...props.style, ...style }}
        />
      </>
    );
  }
);

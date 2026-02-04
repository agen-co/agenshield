/**
 * Styled component utility that filters transient ($-prefixed) props
 */

import { styled as muiStyled } from '@mui/material/styles';

/**
 * Wrapper around MUI's styled() that automatically filters $-prefixed props.
 * Use $prefix for style-only props to prevent them from reaching the DOM.
 *
 * @example
 * const Root = styled$('div', 'ComponentName', 'Root')<{ $active?: boolean }>(
 *   ({ theme, $active }) => ({ ... })
 * );
 */
export function styled$(
  component: React.ElementType,
  componentName: string,
  slot: string = 'Root',
) {
  return muiStyled(component as 'div', {
    name: componentName,
    slot,
    shouldForwardProp: (prop: string) => !prop.startsWith('$'),
  });
}

export { muiStyled as styled };

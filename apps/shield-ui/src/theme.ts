/**
 * MUI Theme configuration for AgenShield
 * Aligned with dashboard-monorepo design system
 */

import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/ibm-plex-mono/latin-500.css';

import { createTheme, darken, lighten, type ThemeOptions, type Color } from '@mui/material/styles';
import type { CSSProperties } from 'react';

// --- Module augmentation ---

declare module '@mui/material/styles' {
  interface TypographyVariants {
    subtitle3: CSSProperties;
    body3: CSSProperties;
    code: CSSProperties;
  }
  interface TypographyVariantsOptions {
    subtitle3?: CSSProperties;
    body3?: CSSProperties;
    code?: CSSProperties;
  }
  interface Palette {
    feedback: Palette['primary'];
    risk: Palette['primary'];
  }
  interface PaletteOptions {
    feedback?: PaletteOptions['primary'];
    risk?: PaletteOptions['primary'];
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    subtitle3: true;
    body3: true;
    code: true;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    feedback: true;
    risk: true;
  }
}

// --- Palettes ---

export const greyPalette: Color = {
  '50': '#F9F9F9',
  '100': '#F2F2F2',
  '200': '#E4E4E4',
  '300': '#D3D3D3',
  '400': '#ABABAB',
  '500': '#808080',
  '600': '#616161',
  '700': '#404040',
  '800': '#323232',
  '900': '#202020',
  A100: '#FFFFFF',
  A200: '#EEEEEE',
  A400: '#BDBDBD',
  A700: '#616161',
};

export const primaryPalette: Color = {
  '50': '#FAFAFA',
  '100': '#F5F5F5',
  '200': '#E5E5E5',
  '300': '#D4D4D4',
  '400': '#A3A3A3',
  '500': '#171717',
  '600': '#0A0A0A',
  '700': '#000000',
  '800': '#000000',
  '900': '#000000',
  A100: '#F5F5F5',
  A200: '#E5E5E5',
  A400: '#404040',
  A700: '#000000',
};

// --- Font family ---

const fontFamily = [
  '"Manrope"',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"',
  '"Segoe UI Symbol"',
].join(',');

// --- Typography ---

const typography: ThemeOptions['typography'] = {
  fontFamily,
  allVariants: {
    fontFamily,
    textUnderlinePosition: 'from-font',
    textDecorationSkipInk: 'none',
    lineHeight: 1.36,
  },
  h1: { fontSize: '2rem', fontWeight: 600, letterSpacing: '0.01em' },
  h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.01em' },
  h3: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.01em' },
  h4: { fontSize: '1.125rem', fontWeight: 500, letterSpacing: '0.01em' },
  h5: { fontSize: '1.125rem', fontWeight: 700, letterSpacing: '0.02em' },
  h6: { fontSize: '1rem', fontWeight: 700, letterSpacing: '0.01em' },
  subtitle1: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.72, letterSpacing: '0.01em' },
  subtitle2: { fontSize: '0.75rem', fontWeight: 600, lineHeight: 1 + 1 / 3, letterSpacing: '0.01em' },
  subtitle3: { fontSize: '0.625rem', fontWeight: 400, letterSpacing: '0.01em' },
  body1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '0em' },
  body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.57, letterSpacing: '0em' },
  body3: { fontSize: '0.75rem', fontWeight: 400, letterSpacing: '0em' },
  caption: { fontSize: '0.75rem', fontWeight: 400, letterSpacing: '0.005em' },
  overline: { fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em' },
  code: {
    fontFamily: '"IBM Plex Mono"',
    fontSize: '0.875rem',
    fontWeight: 500,
    lineHeight: 1.72,
    letterSpacing: '0.01em',
  },
};

// --- Component overrides ---

const components: ThemeOptions['components'] = {
  MuiButtonBase: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        transition: theme.transitions.create('background-color'),
      }),
    },
  },
  MuiButton: {
    defaultProps: {
      variant: 'contained',
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        textTransform: 'unset' as const,
        justifyContent: 'center',
      },
      startIcon: {
        marginLeft: 0,
        '& > *:nth-of-type(1)': { fontSize: '1rem' },
        '&.MuiButton-iconSizeLarge': { marginRight: '0.75rem', marginLeft: '-0.25rem' },
        '&.MuiButton-iconSizeMedium': { marginRight: '0.25rem', marginLeft: '-0.1rem' },
        '&.MuiButton-iconSizeSmall': { marginRight: '0.25rem', marginLeft: '-0.1rem' },
      },
      endIcon: {
        marginLeft: 'auto',
        marginRight: 0,
        '& > *:nth-of-type(1)': { fontSize: '1rem' },
      },
      sizeSmall: {
        minWidth: '3.75rem',
        padding: '0.25rem 0.5rem',
        fontSize: '0.875rem',
        lineHeight: '1rem',
        letterSpacing: 0,
        fontWeight: 600,
        height: '1.75rem',
      },
      sizeMedium: {
        minWidth: '3.75rem',
        padding: '0.25rem 0.5rem',
        fontSize: '0.875rem',
        lineHeight: '1.25rem',
        fontWeight: 600,
        height: '2rem',
      },
      sizeLarge: {
        minWidth: '3.75rem',
        padding: '0.5625rem 1rem',
        fontSize: '1rem',
        lineHeight: '1.25rem',
        fontWeight: 700,
        height: '2.5rem',
      },
    },
    variants: [
      {
        props: { color: 'primary', variant: 'contained' },
        style: ({ theme }) => ({
          '&:hover, &.Mui-hover': {
            backgroundColor:
              theme.palette.mode === 'light'
                ? lighten(theme.palette.primary.main, 0.2)
                : darken(theme.palette.primary.main, 0.1),
          },
          '&:active, &.Mui-active': {
            backgroundColor:
              theme.palette.mode === 'light'
                ? lighten(theme.palette.primary.main, 0.1)
                : darken(theme.palette.primary.main, 0.2),
          },
          '&.Mui-disabled': {
            backgroundColor: theme.palette.grey[200],
            color: theme.palette.grey[500],
          },
        }),
      },
      {
        props: { color: 'primary', variant: 'outlined' },
        style: ({ theme }) => ({
          '&:hover, &.Mui-hover': { borderColor: theme.palette.primary.dark },
          '&:active, &.Mui-active': { borderColor: darken(theme.palette.primary.dark, 0.1) },
        }),
      },
      {
        props: { variant: 'outlined', color: 'secondary' },
        style: ({ theme }) => ({
          borderColor: theme.palette.divider,
          color: theme.palette.text.primary,
          '&:hover, &.Mui-hover': {
            borderColor: theme.palette.grey[300],
            backgroundColor: theme.palette.action.hover,
          },
          '&:active, &.Mui-active': {
            backgroundColor: theme.palette.action.selected,
          },
          '&.Mui-disabled': {
            color: theme.palette.grey[400],
            borderColor: theme.palette.grey[200],
          },
        }),
      },
      {
        props: { color: 'secondary', variant: 'text' },
        style: ({ theme }) => ({
          color: theme.palette.text.primary,
          '&:hover, &.Mui-hover': {
            backgroundColor: theme.palette.action.hover,
          },
          '&:active, &.Mui-active': {
            backgroundColor: theme.palette.action.selected,
          },
          '&.Mui-disabled': {
            color: theme.palette.grey[400],
          },
        }),
      },
      {
        props: { color: 'error', variant: 'contained' },
        style: ({ theme }) => ({
          '&:hover, &.Mui-hover': { backgroundColor: theme.palette.error.dark },
          '&:active, &.Mui-active': { backgroundColor: darken(theme.palette.error.dark as string, 0.1) },
        }),
      },
    ],
  },
  MuiCard: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: ({ theme }) => ({
        transition: theme.transitions.create('background-color'),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: (theme.shape.borderRadius as number) * 2,
        padding: theme.spacing(3),
      }),
    },
  },
  MuiCardContent: {
    styleOverrides: {
      root: {
        padding: 0,
        '&:last-child': { paddingBottom: 0 },
      },
    },
  },
  MuiChip: {
    defaultProps: { color: 'primary' },
    styleOverrides: {
      root: ({ theme }) => ({
        transition: theme.transitions.create('background-color'),
        fontWeight: 600,
      }),
      sizeSmall: {
        height: '1rem',
        '& .MuiChip-label': {
          padding: '0rem 0.25rem',
          fontSize: '.75rem',
          lineHeight: '1rem',
          letterSpacing: 0.01,
          fontWeight: 600,
        },
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: (theme.shape.borderRadius as number) * 2,
      }),
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        textTransform: 'none' as const,
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRadius: (theme.shape.borderRadius as number) * 3,
      }),
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: theme.spacing(3),
        paddingBottom: theme.spacing(1),
        fontSize: '1.125rem',
        fontWeight: 600,
      }),
    },
  },
  MuiDialogContent: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: theme.spacing(3),
        paddingTop: theme.spacing(2),
      }),
    },
  },
  MuiDialogActions: {
    styleOverrides: {
      root: ({ theme }) => ({
        padding: theme.spacing(2, 3),
        gap: theme.spacing(1),
      }),
    },
  },
  MuiSwitch: {
    styleOverrides: {
      root: ({ theme }) => ({
        width: 42,
        height: 26,
        padding: 0,
        '& .MuiSwitch-switchBase': {
          padding: 0,
          margin: 2,
          transitionDuration: '200ms',
          '&.Mui-checked': {
            transform: 'translateX(16px)',
            color: '#fff',
            '& + .MuiSwitch-track': {
              backgroundColor: theme.palette.primary.main,
              opacity: 1,
              border: 0,
            },
          },
          '&.Mui-disabled + .MuiSwitch-track': {
            opacity: 0.5,
          },
        },
        '& .MuiSwitch-thumb': {
          boxSizing: 'border-box',
          width: 22,
          height: 22,
        },
        '& .MuiSwitch-track': {
          borderRadius: 13,
          backgroundColor: theme.palette.grey[300],
          opacity: 1,
          transition: theme.transitions.create(['background-color'], { duration: 200 }),
        },
      }),
    },
  },
  MuiMenu: {
    defaultProps: {
      transitionDuration: 150,
    },
    styleOverrides: {
      paper: ({ theme }) => ({
        marginTop: theme.spacing(0.5),
        borderRadius: (theme.shape.borderRadius as number) * 2,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 4px 16px rgba(0,0,0,0.08)'
            : '0 4px 16px rgba(0,0,0,0.32)',
      }),
      list: {
        padding: '4px',
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        fontSize: '0.875rem',
        minHeight: 36,
        '&.Mui-selected': {
          backgroundColor: theme.palette.action.selected,
        },
      }),
    },
  },
  MuiTextField: {
    defaultProps: {
      variant: 'outlined',
      size: 'small',
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme }) => ({
        fontSize: '0.875rem',
        lineHeight: 1.5,
        borderRadius: theme.shape.borderRadius,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: theme.palette.divider,
          top: 0,
          '& legend': { display: 'none' },
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: theme.palette.grey[400],
        },
        '&.MuiInputBase-multiline': {
          padding: 0,
        },
      }),
      input: {
        padding: '8px 12px',
        lineHeight: 1.5,
        '&::placeholder': {
          lineHeight: 1.5,
        },
      },
      inputMultiline: {
        padding: '8px 12px',
      },
    },
  },
  MuiInputLabel: {
    defaultProps: {
      shrink: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        position: 'relative',
        transform: 'none',
        fontSize: '0.875rem',
        fontWeight: 600,
        color: theme.palette.text.primary,
        marginBottom: theme.spacing(1),
        '&.Mui-focused': {
          color: theme.palette.text.primary,
        },
      }),
    },
  },
  MuiFormControl: {
    defaultProps: {
      size: 'small',
    },
  },
};

// --- Theme creation ---

const baseTheme: ThemeOptions = {
  typography,
  spacing: 8,
  shape: { borderRadius: 4 },
  components,
};

export const lightTheme = createTheme({
  ...baseTheme,
  palette: {
    mode: 'light',
    primary: {
      main: primaryPalette['500'],
      light: primaryPalette['200'],
      dark: primaryPalette['600'],
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: greyPalette['500'],
      light: greyPalette['200'],
      dark: greyPalette['600'],
      contrastText: greyPalette['700'],
    },
    error: {
      main: '#E1583E',
      light: '#F6AA9C',
      dark: '#D64226',
    },
    warning: {
      main: '#EEA45F',
      light: '#FDC897',
      dark: '#DC8534',
    },
    success: {
      main: '#6CB685',
      light: '#B6E4C6',
      dark: '#3F945B',
    },
    info: {
      main: '#6BAEF2',
      light: '#B5D7FF',
      dark: '#3789DC',
    },
    feedback: {
      main: '#6EC2C8',
      light: '#B1E4E8',
      dark: '#3C9CA2',
      contrastText: '#FFFFFF',
    },
    risk: {
      main: '#FFDF5E',
      light: '#FFF2BF',
      dark: '#998638',
      contrastText: '#332D13',
    },
    grey: greyPalette,
    divider: greyPalette['200'],
    background: {
      default: '#F9F9F9',
      paper: '#FFFFFF',
    },
    text: {
      primary: greyPalette['900'],
      secondary: greyPalette['600'],
    },
  },
});

export const darkTheme = createTheme({
  ...baseTheme,
  palette: {
    mode: 'dark',
    primary: {
      main: '#EDEDED',
      light: '#FFFFFF',
      dark: '#D4D4D4',
      contrastText: '#0A0A0A',
    },
    secondary: {
      main: greyPalette['400'],
      light: greyPalette['600'],
      dark: greyPalette['300'],
      contrastText: greyPalette['200'],
    },
    error: {
      main: '#EF816D',
      light: '#F6AA9C',
      dark: '#D64226',
    },
    warning: {
      main: '#F6B77D',
      light: '#FDC897',
      dark: '#DC8534',
    },
    success: {
      main: '#93D1A9',
      light: '#B6E4C6',
      dark: '#3F945B',
    },
    info: {
      main: '#92C4FE',
      light: '#B5D7FF',
      dark: '#3789DC',
    },
    feedback: {
      main: '#90D5D9',
      light: '#B1E4E8',
      dark: '#3C9CA2',
      contrastText: '#FFFFFF',
    },
    risk: {
      main: '#FFE57E',
      light: '#FFF2BF',
      dark: '#998638',
      contrastText: '#332D13',
    },
    grey: greyPalette,
    divider: '#1F1F1F',
    background: {
      default: '#000000',
      paper: '#0A0A0A',
    },
    text: {
      primary: greyPalette['100'],
      secondary: greyPalette['400'],
    },
  },
});

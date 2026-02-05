import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'MarkdownViewer',
  slot: 'Root',
})(({ theme }) => ({
  fontFamily: theme.typography.fontFamily,
  fontSize: 14,
  lineHeight: 1.7,
  color: theme.palette.text.primary,

  '& > :first-child': {
    marginTop: 0,
  },

  '& h1, & h2, & h3, & h4, & h5, & h6': {
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(1),
    fontWeight: 600,
    lineHeight: 1.3,
  },
  '& h1': { fontSize: '1.75rem' },
  '& h2': { fontSize: '1.5rem' },
  '& h3': { fontSize: '1.25rem' },
  '& h4': { fontSize: '1.1rem' },

  '& p': {
    margin: `${theme.spacing(1)} 0`,
  },

  '& code': {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.875em',
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor: theme.palette.action.hover,
  },

  '& pre': {
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.mode === 'dark' ? '#0d1117' : '#f6f8fa',
    overflow: 'auto',
    '& code': {
      padding: 0,
      backgroundColor: 'transparent',
    },
  },

  '& ul, & ol': {
    paddingLeft: theme.spacing(3),
    margin: `${theme.spacing(1)} 0`,
  },

  '& li': {
    marginBottom: theme.spacing(0.5),
  },

  '& blockquote': {
    margin: `${theme.spacing(2)} 0`,
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    borderLeft: `3px solid ${theme.palette.primary.main}`,
    backgroundColor: theme.palette.action.hover,
    borderRadius: `0 ${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0`,
  },

  '& a': {
    color: theme.palette.primary.main,
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },

  '& hr': {
    border: 'none',
    borderTop: `1px solid ${theme.palette.divider}`,
    margin: `${theme.spacing(3)} 0`,
  },

  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    margin: `${theme.spacing(2)} 0`,
  },
  '& th, & td': {
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    border: `1px solid ${theme.palette.divider}`,
    textAlign: 'left',
  },
  '& th': {
    fontWeight: 600,
    backgroundColor: theme.palette.action.hover,
  },
}));

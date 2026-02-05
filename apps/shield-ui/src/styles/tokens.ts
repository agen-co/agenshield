/**
 * Design tokens aligned with dashboard-monorepo
 */

export const tokens = {
  sidebar: {
    width: 260,
    collapsedWidth: 72,
  },
  toolbar: {
    height: 56,
  },
  page: {
    maxWidth: 1340,
  },
  sidePanel: {
    width: 480,
  },
  zIndex: {
    navigation: 200,
    toolbar: 100,
    floating: 10,
  },
  transition: {
    duration: '220ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
} as const;

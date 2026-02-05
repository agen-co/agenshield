import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

/**
 * Blocks in-app navigation when the form is dirty.
 * Uses UNSAFE_NavigationContext to intercept Link / navigate() calls
 * (useBlocker requires a data router which we don't use).
 * Also prevents tab/window close via beforeunload.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  // Capture the original navigator methods once on mount
  const origRef = useRef({
    push: navigator.push,
    replace: navigator.replace,
  });

  // Intercept react-router navigation (Link clicks, navigate())
  useEffect(() => {
    if (!dirty) return;

    const { push: origPush, replace: origReplace } = origRef.current;

    navigator.push = (...args: Parameters<typeof navigator.push>) => {
      setPendingNav(() => () => origPush.apply(navigator, args));
    };
    navigator.replace = (...args: Parameters<typeof navigator.replace>) => {
      setPendingNav(() => () => origReplace.apply(navigator, args));
    };

    return () => {
      navigator.push = origPush;
      navigator.replace = origReplace;
    };
  }, [dirty, navigator]);

  // beforeunload for tab / window close
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirm = useCallback(() => {
    const nav = pendingNav;
    setPendingNav(null);
    nav?.();
  }, [pendingNav]);

  const cancel = useCallback(() => {
    setPendingNav(null);
  }, []);

  return {
    guardOpen: pendingNav !== null,
    guardConfirm: confirm,
    guardCancel: cancel,
  };
}

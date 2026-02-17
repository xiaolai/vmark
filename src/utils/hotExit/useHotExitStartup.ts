/**
 * Hot Exit Startup Hook
 *
 * Checks for saved session on app startup and triggers restore if present.
 * Should be called once in the main window only.
 *
 * IMPORTANT: This hook sets a coordination flag that other startup hooks
 * (like useFinderFileOpen) should wait for before processing. This prevents
 * race conditions where Finder-opened files could be lost.
 */

import { useEffect, useRef } from 'react';
import { checkAndRestoreSession } from './restartWithHotExit';
import {
  setRestoreInProgress,
  notifyRestoreComplete,
} from './hotExitCoordination';
import { hotExitLog } from '@/utils/debug';

export function useHotExitStartup() {
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    // Check for saved session and restore if present
    // This runs once on app startup in the main window
    const checkSession = async () => {
      // Signal that restore might be in progress
      // Other hooks (useFinderFileOpen) should wait for this to complete
      setRestoreInProgress(true);

      try {
        const restored = await checkAndRestoreSession();
        if (restored) {
          hotExitLog('Startup: session restored successfully');
        }
      } finally {
        // Always notify completion, even if restore failed or no session existed
        notifyRestoreComplete();
      }
    };

    checkSession();
  }, []);
}

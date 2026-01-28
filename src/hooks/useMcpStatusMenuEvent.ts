/**
 * MCP Status Menu Event Hook
 *
 * Handles the Help → MCP Server Status menu event.
 */

import { useEffect, useRef } from "react";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";

/**
 * Hook to handle the MCP Server Status menu event.
 */
export function useMcpStatusMenuEvent() {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const openDialog = useMcpHealthStore((state) => state.openDialog);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      // Clean up existing listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      if (cancelled) return;

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      // Listen for MCP status menu event
      unlistenRef.current = await currentWindow.listen<string>(
        "menu:mcp-status",
        (event) => {
          if (event.payload !== windowLabel) return;
          openDialog();
        }
      );
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [openDialog]);
}

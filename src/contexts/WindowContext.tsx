import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useDocumentStore } from "../stores/documentStore";

interface WindowContextValue {
  windowLabel: string;
  isDocumentWindow: boolean;
}

const WindowContext = createContext<WindowContextValue | null>(null);

interface WindowProviderProps {
  children: ReactNode;
}

export function WindowProvider({ children }: WindowProviderProps) {
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const window = getCurrentWebviewWindow();
        const label = window.label;
        setWindowLabel(label);

        // CRITICAL: Only init documents for document windows (main, doc-*)
        // Settings, print-preview, etc. don't need document state
        if (label === "main" || label.startsWith("doc-")) {
          const doc = useDocumentStore.getState().getDocument(label);
          if (!doc) {
            // Check if we have a file path in the URL query params
            const urlParams = new URLSearchParams(globalThis.location?.search || "");
            const filePath = urlParams.get("file");
            useDocumentStore.getState().initDocument(label, "", filePath ?? null);
          }
        }

        setIsReady(true);
      } catch (error) {
        console.error("[WindowContext] Init failed:", error);
        // Still set ready to allow error boundary to catch render errors
        setIsReady(true);
      }
    };

    init();
  }, []);

  const isDocumentWindow = windowLabel === "main" || windowLabel.startsWith("doc-");

  if (!isReady) {
    return null; // Don't render until window label is determined
  }

  return (
    <WindowContext.Provider value={{ windowLabel, isDocumentWindow }}>
      {children}
    </WindowContext.Provider>
  );
}

export function useWindowLabel(): string {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error("useWindowLabel must be used within WindowProvider");
  }
  return context.windowLabel;
}

export function useIsDocumentWindow(): boolean {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error("useIsDocumentWindow must be used within WindowProvider");
  }
  return context.isDocumentWindow;
}

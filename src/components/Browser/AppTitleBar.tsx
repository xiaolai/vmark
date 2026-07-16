/**
 * AppTitleBar
 *
 * Purpose: The app's title bar with browser awareness — renders the titlebar
 * browser chrome when a browser workspace is active, otherwise the plain
 * document title bar. Keeps browser-feature knowledge out of the App.tsx
 * composition root, and subscribes only to a primitive `active` boolean so the
 * shell does not re-render on unrelated tab-metadata changes.
 *
 * @coordinates-with useBrowserWorkspaceState.ts — useBrowserWorkspaceActive selector
 * @module components/Browser/AppTitleBar
 */
import { TitleBar } from "@/components/TitleBar";
import { BrowserChrome } from "./BrowserChrome";
import { useBrowserWorkspaceActive } from "./useBrowserWorkspaceState";

export function AppTitleBar() {
  const browserWorkspaceActive = useBrowserWorkspaceActive();
  return (
    <TitleBar browserChrome={browserWorkspaceActive ? <BrowserChrome placement="titlebar" /> : null} />
  );
}

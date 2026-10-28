/**
 * McpBridgeListenerWarning — persistent status-bar warning that this window
 * cannot answer AI (MCP) requests because its request listener never
 * registered.
 *
 * Key decisions:
 *   - Reads stored state (`mcpBridgeListenerStore`), so it shows the failure
 *     even when it mounts after the hook gave up.
 *   - Persistent, not a toast: the condition lasts until the window is
 *     reloaded, so the signal does too.
 *   - role="status" like the AI indicator; the full explanation rides in the
 *     title, the visible text stays short.
 *   - Styles live in StatusBar.css (`.status-mcp-listener-warning`) — one CSS
 *     file per surface.
 *
 * @coordinates-with stores/mcpBridgeListenerStore.ts — the health it shows
 * @coordinates-with StatusBarRight.tsx — renders it beside the MCP badge
 * @module components/StatusBar/McpBridgeListenerWarning
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { useMcpBridgeListenerStore } from "@/stores/mcpBridgeListenerStore";
import { ICON_SM } from "@/utils/iconSizes";

/** Warning shown while this window's MCP request listener is not registered after every retry. */
export function McpBridgeListenerWarning() {
  const { t } = useTranslation("statusbar");
  const failed = useMcpBridgeListenerStore((s) => s.status === "failed");
  if (!failed) return null;
  return (
    <span
      className="status-mcp-listener-warning"
      role="status"
      aria-live="polite"
      title={t("mcpListenerFailedTitle")}
    >
      <AlertTriangle size={ICON_SM} aria-hidden="true" />
      <span>{t("mcpListenerFailed")}</span>
    </span>
  );
}

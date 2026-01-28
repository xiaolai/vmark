/**
 * MCP Status Dialog
 *
 * Displays detailed MCP server diagnostics including connection status,
 * version, tool count, and available tools list.
 */

import { useEffect, useCallback } from "react";
import { X, RefreshCw, CheckCircle, XCircle, Copy, Check } from "lucide-react";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";
import { useMcpHealthCheck } from "@/hooks/useMcpHealthCheck";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useState } from "react";
import "./McpStatusDialog.css";

export function McpStatusDialog() {
  const { dialogOpen, closeDialog, health } = useMcpHealthStore();
  const { runHealthCheck, isChecking, version, toolCount, resourceCount } = useMcpHealthCheck();
  const { running, port, loading } = useMcpServer();
  const [copiedTools, setCopiedTools] = useState(false);

  // Run health check when dialog opens
  useEffect(() => {
    if (dialogOpen) {
      runHealthCheck();
    }
  }, [dialogOpen, runHealthCheck]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogOpen) {
        closeDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, closeDialog]);

  const handleCopyTools = useCallback(() => {
    const toolsList = health.tools.join("\n");
    navigator.clipboard.writeText(toolsList);
    setCopiedTools(true);
    setTimeout(() => setCopiedTools(false), 2000);
  }, [health.tools]);

  if (!dialogOpen) return null;

  const isHealthy = running && !health.checkError;

  return (
    <div className="mcp-status-overlay" onClick={closeDialog}>
      <div className="mcp-status-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mcp-status-header">
          <h2>MCP Server Status</h2>
          <button className="mcp-status-close" onClick={closeDialog} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Status summary */}
        <div className="mcp-status-summary">
          <div className={`mcp-status-indicator ${isHealthy ? "healthy" : "unhealthy"}`}>
            {isHealthy ? (
              <>
                <CheckCircle size={24} />
                <span>Healthy</span>
              </>
            ) : (
              <>
                <XCircle size={24} />
                <span>{running ? "Error" : "Stopped"}</span>
              </>
            )}
          </div>
          <button
            className="mcp-status-refresh"
            onClick={() => runHealthCheck()}
            disabled={isChecking}
            title="Refresh status"
          >
            <RefreshCw size={16} className={isChecking ? "spinning" : ""} />
          </button>
        </div>

        {/* Details */}
        <div className="mcp-status-details">
          <div className="mcp-status-row">
            <span className="mcp-status-label">Bridge Status</span>
            <span className={`mcp-status-value ${running ? "success" : "error"}`}>
              {loading ? "Starting..." : running ? "Running" : "Stopped"}
            </span>
          </div>

          {running && port && (
            <div className="mcp-status-row">
              <span className="mcp-status-label">Port</span>
              <span className="mcp-status-value mono">{port}</span>
            </div>
          )}

          <div className="mcp-status-row">
            <span className="mcp-status-label">Version</span>
            <span className="mcp-status-value mono">{version}</span>
          </div>

          <div className="mcp-status-row">
            <span className="mcp-status-label">Tools Available</span>
            <span className="mcp-status-value">{toolCount}</span>
          </div>

          <div className="mcp-status-row">
            <span className="mcp-status-label">Resources Available</span>
            <span className="mcp-status-value">{resourceCount}</span>
          </div>

          {health.lastChecked && (
            <div className="mcp-status-row">
              <span className="mcp-status-label">Last Checked</span>
              <span className="mcp-status-value">
                {health.lastChecked.toLocaleTimeString()}
              </span>
            </div>
          )}

          {health.checkError && (
            <div className="mcp-status-error">
              <span className="mcp-status-error-label">Error</span>
              <span className="mcp-status-error-message">{health.checkError}</span>
            </div>
          )}
        </div>

        {/* Tools list */}
        <div className="mcp-status-tools">
          <div className="mcp-status-tools-header">
            <span>Available Tools ({health.tools.length})</span>
            <button
              className="mcp-status-copy"
              onClick={handleCopyTools}
              title="Copy tool list"
            >
              {copiedTools ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <div className="mcp-status-tools-list">
            {health.tools.map((tool) => (
              <code key={tool} className="mcp-status-tool">
                {tool}
              </code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

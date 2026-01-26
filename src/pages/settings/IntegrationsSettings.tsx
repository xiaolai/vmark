/**
 * Integrations Settings Section
 *
 * MCP server and AI assistant integration settings.
 */

import { useState } from "react";
import { SettingRow, Toggle, SettingsGroup, CopyButton } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useAIAgent } from "@/hooks/useAIAgent";
import { McpConfigInstaller } from "./McpConfigInstaller";
import { invoke } from "@tauri-apps/api/core";

function StatusBadge({ running, loading }: { running: boolean; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <span className="w-2 h-2 rounded-full bg-[var(--warning-color)] animate-pulse" />
        Starting...
      </span>
    );
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
        <span className="w-2 h-2 rounded-full bg-[var(--success-color)]" />
        Running
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
      <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
      Stopped
    </span>
  );
}

export function IntegrationsSettings() {
  const mcpSettings = useSettingsStore((state) => state.advanced.mcpServer);
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);

  const { running, port, loading, error, start, stop } = useMcpServer();


  const handleToggleServer = async (enabled: boolean) => {
    if (enabled) {
      try {
        await start();
      } catch {
        // Error is handled by hook
      }
    } else {
      try {
        await stop();
      } catch {
        // Error is handled by hook
      }
    }
  };

  const handleAutoStartChange = (enabled: boolean) => {
    updateAdvancedSetting("mcpServer", { ...mcpSettings, autoStart: enabled });
  };

  const handleAutoApproveChange = (enabled: boolean) => {
    updateAdvancedSetting("mcpServer", { ...mcpSettings, autoApproveEdits: enabled });
  };

  // Called after MCP config is successfully installed to a provider
  // Enables autoStart and starts the bridge so it works immediately
  const handleMcpConfigInstalled = async () => {
    // Enable autoStart so bridge runs on future launches
    if (!mcpSettings.autoStart) {
      updateAdvancedSetting("mcpServer", { ...mcpSettings, autoStart: true });
    }
    // Start the bridge now if not already running
    if (!running && !loading) {
      try {
        await start();
      } catch {
        // Error handled by hook, user can see status indicator
      }
    }
  };

  return (
    <div>
      <SettingsGroup title="MCP Server">
        <SettingRow
          label="Enable MCP Server"
          description="Allow AI assistants to control VMark editor"
        >
          <div className="flex items-center gap-3">
            <StatusBadge running={running} loading={loading} />
            <Toggle
              checked={running}
              onChange={handleToggleServer}
              disabled={loading}
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Start on launch"
          description="Auto-start when VMark opens"
        >
          <Toggle
            checked={mcpSettings.autoStart}
            onChange={handleAutoStartChange}
          />
        </SettingRow>

        <SettingRow
          label="Auto-approve edits"
          description="Apply AI changes without preview (use with caution)"
        >
          <Toggle
            checked={mcpSettings.autoApproveEdits}
            onChange={handleAutoApproveChange}
          />
        </SettingRow>

        {error && (
          <div className="mt-2 text-xs text-[var(--error-color)]">
            {error}
          </div>
        )}

        {running && port && (
          <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
            <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
              <span>Listening on</span>
              <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono">
                localhost:{port}
              </code>
              <CopyButton text={`localhost:${port}`} />
            </div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              Port auto-assigned. AI clients discover it automatically.
            </div>
          </div>
        )}
      </SettingsGroup>

      <div className="mt-6">
        <McpConfigInstaller onInstallSuccess={handleMcpConfigInstalled} />
      </div>

      <div className="mt-6">
        <AIAssistantSettings />
      </div>
    </div>
  );
}

/**
 * AI Assistant Settings Component
 *
 * Claude Code detection and API key configuration.
 */
function AIAssistantSettings() {
  const { claudeInstalled, claudeVersion, hasApiKey, refresh } = useAIAgent();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"idle" | "valid" | "invalid" | "saved">("idle");
  const [keyError, setKeyError] = useState<string | null>(null);

  const handleCheckClaude = async () => {
    await refresh();
  };

  const handleTestKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsTestingKey(true);
    setKeyError(null);
    setKeyStatus("idle");

    try {
      const isValid = await invoke<boolean>("test_api_key", { key: apiKeyInput });
      setKeyStatus(isValid ? "valid" : "invalid");
      if (!isValid) {
        setKeyError("Invalid API key");
      }
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
      setKeyStatus("invalid");
    } finally {
      setIsTestingKey(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsSavingKey(true);
    setKeyError(null);

    try {
      await invoke("set_api_key", { key: apiKeyInput });
      setKeyStatus("saved");
      setApiKeyInput("");
      await refresh();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleClearKey = async () => {
    try {
      await invoke("clear_api_key");
      setKeyStatus("idle");
      await refresh();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <SettingsGroup title="AI Assistant">
      {/* Claude Code Status */}
      <SettingRow
        label="Claude Code"
        description={
          claudeInstalled
            ? `Version ${claudeVersion || "unknown"}`
            : "VMark's AI features require Claude Code CLI"
        }
      >
        <div className="flex items-center gap-3">
          {claudeInstalled ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
              <span className="w-2 h-2 rounded-full bg-[var(--success-color)]" />
              Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--warning-color)]">
              <span className="w-2 h-2 rounded-full bg-[var(--warning-color)]" />
              Not found
            </span>
          )}
          <button
            onClick={handleCheckClaude}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg-strong)] transition-colors"
          >
            Check
          </button>
        </div>
      </SettingRow>

      {!claudeInstalled && (
        <div className="mt-2 p-3 rounded-md bg-[var(--warning-bg)] border border-[var(--warning-border)] text-xs">
          <p className="font-medium text-[var(--warning-color)]">Installation Required</p>
          <ol className="mt-2 ml-4 list-decimal text-[var(--text-secondary)] space-y-1">
            <li>Install from: <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer" className="text-[var(--primary-color)] hover:underline">claude.ai/code</a></li>
            <li>Run <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]">claude</code> once to authenticate</li>
            <li>Click Check above to verify</li>
          </ol>
        </div>
      )}

      {/* API Key */}
      <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
        <SettingRow
          label="API Key"
          description={
            hasApiKey
              ? "API key is stored in system keychain"
              : "Optional if ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is in env"
          }
        >
          <div className="flex items-center gap-2">
            {hasApiKey ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--success-color)]" />
                  Configured
                </span>
                <button
                  onClick={handleClearKey}
                  className="px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--error-bg)] hover:text-[var(--error-color)] transition-colors"
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
                Not set
              </span>
            )}
          </div>
        </SettingRow>

        {!hasApiKey && (
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 px-2 py-1.5 text-xs font-mono rounded border border-[var(--border-color)] bg-[var(--bg-color)] focus:border-[var(--primary-color)] outline-none"
            />
            <button
              onClick={handleTestKey}
              disabled={isTestingKey || !apiKeyInput.trim()}
              className="px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg-strong)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTestingKey ? "Testing..." : "Test"}
            </button>
            <button
              onClick={handleSaveKey}
              disabled={isSavingKey || !apiKeyInput.trim()}
              className="px-3 py-1.5 text-xs rounded bg-[var(--primary-color)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSavingKey ? "Saving..." : "Save"}
            </button>
          </div>
        )}

        {keyError && (
          <div className="mt-2 text-xs text-[var(--error-color)]">
            {keyError}
          </div>
        )}

        {keyStatus === "valid" && (
          <div className="mt-2 text-xs text-[var(--success-color)]">
            API key is valid
          </div>
        )}

        {keyStatus === "saved" && (
          <div className="mt-2 text-xs text-[var(--success-color)]">
            API key saved to keychain
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

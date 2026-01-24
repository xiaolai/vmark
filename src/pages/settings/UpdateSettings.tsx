/**
 * Update Settings Section
 *
 * Settings for automatic update checking and installation.
 */

import { useState } from "react";
import { SettingRow, Toggle, SettingsGroup, Select } from "./components";
import { useSettingsStore, type UpdateCheckFrequency } from "@/stores/settingsStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useUpdateOperations } from "@/hooks/useUpdateOperations";
import { Loader2, CheckCircle2, AlertCircle, Download } from "lucide-react";

const frequencyOptions: { value: UpdateCheckFrequency; label: string }[] = [
  { value: "startup", label: "On startup" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "manual", label: "Manual only" },
];

function StatusIndicator() {
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const error = useUpdateStore((state) => state.error);

  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking...
      </span>
    );
  }

  if (status === "up-to-date") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="w-3 h-3" />
        Up to date
      </span>
    );
  }

  if (status === "available" && updateInfo) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--primary-color)]">
        <Download className="w-3 h-3" />
        {updateInfo.version} available
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--error-color)]">
        <AlertCircle className="w-3 h-3" />
        {error || "Check failed"}
      </span>
    );
  }

  return null;
}

export function UpdateSettings() {
  const updateSettings = useSettingsStore((state) => state.update);
  const updateUpdateSetting = useSettingsStore((state) => state.updateUpdateSetting);
  const status = useUpdateStore((state) => state.status);
  const { checkForUpdates } = useUpdateOperations();
  const [isChecking, setIsChecking] = useState(false);

  const handleAutoCheckChange = (enabled: boolean) => {
    updateUpdateSetting("autoCheckEnabled", enabled);
  };

  const handleFrequencyChange = (frequency: UpdateCheckFrequency) => {
    updateUpdateSetting("checkFrequency", frequency);
  };

  const handleAutoDownloadChange = (enabled: boolean) => {
    updateUpdateSetting("autoDownload", enabled);
  };

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      await checkForUpdates();
    } finally {
      setIsChecking(false);
    }
  };

  // Format last check time
  const lastCheckText = updateSettings.lastCheckTimestamp
    ? new Date(updateSettings.lastCheckTimestamp).toLocaleString()
    : "Never";

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Updates
      </h2>

      <SettingsGroup title="Automatic Updates">
        <SettingRow
          label="Check for updates automatically"
          description="Periodically check for new versions"
        >
          <Toggle
            checked={updateSettings.autoCheckEnabled}
            onChange={handleAutoCheckChange}
          />
        </SettingRow>

        <SettingRow
          label="Check frequency"
          description="How often to check for updates"
          disabled={!updateSettings.autoCheckEnabled}
        >
          <Select
            value={updateSettings.checkFrequency}
            options={frequencyOptions}
            onChange={handleFrequencyChange}
            disabled={!updateSettings.autoCheckEnabled}
          />
        </SettingRow>

        <SettingRow
          label="Download updates automatically"
          description="Download in the background when available"
        >
          <Toggle
            checked={updateSettings.autoDownload}
            onChange={handleAutoDownloadChange}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Manual Check">
        <SettingRow label="Check now" description={`Last checked: ${lastCheckText}`}>
          <div className="flex items-center gap-3">
            <StatusIndicator />
            <button
              onClick={handleCheckNow}
              disabled={isChecking || status === "checking"}
              className="px-3 py-1.5 rounded text-sm font-medium
                         bg-[var(--bg-tertiary)] text-[var(--text-primary)]
                         hover:bg-[var(--hover-bg)] disabled:opacity-50
                         disabled:cursor-not-allowed transition-colors"
            >
              {isChecking || status === "checking" ? "Checking..." : "Check for Updates"}
            </button>
          </div>
        </SettingRow>
      </SettingsGroup>

      {updateSettings.skipVersion && (
        <div className="mt-4 text-xs text-[var(--text-tertiary)]">
          Skipped version: {updateSettings.skipVersion}{" "}
          <button
            onClick={() => updateUpdateSetting("skipVersion", null)}
            className="text-[var(--primary-color)] hover:underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

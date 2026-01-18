/**
 * Advanced Settings Section
 *
 * Developer and system configuration.
 */

import { useState } from "react";
import { SettingRow, Toggle } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";

export function AdvancedSettings() {
  const [devTools, setDevTools] = useState(false);
  const [hardwareAccel, setHardwareAccel] = useState(true);
  const enableCommandMenu = useSettingsStore((state) => state.advanced.enableCommandMenu);
  const terminalEnabled = useSettingsStore((state) => state.advanced.terminalEnabled);
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Advanced
      </h2>
      <div className="space-y-1">
        <SettingRow
          label="Enable terminal"
          description="Show integrated terminal panel (Ctrl+`)"
        >
          <Toggle
            checked={terminalEnabled}
            onChange={(v) => updateAdvancedSetting("terminalEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="Enable command menu"
          description="Show AI command menu and related settings"
        >
          <Toggle
            checked={enableCommandMenu}
            onChange={(v) => updateAdvancedSetting("enableCommandMenu", v)}
          />
        </SettingRow>
        <SettingRow label="Developer tools" description="Enable developer mode">
          <Toggle checked={devTools} onChange={setDevTools} />
        </SettingRow>
        <SettingRow
          label="Hardware acceleration"
          description="Use GPU for rendering"
        >
          <Toggle checked={hardwareAccel} onChange={setHardwareAccel} />
        </SettingRow>
      </div>
    </div>
  );
}

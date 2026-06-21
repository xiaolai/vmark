/**
 * Terminal Settings Section
 *
 * Shell selection, panel position, panel size, font size, line height,
 * and other terminal options.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type TerminalPosition, type TerminalCursorStyle, type TerminalBellMode } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";
import { terminalSettingsWarn } from "@/utils/debug";
import { isMacPlatform, isWindowsPlatform } from "@/utils/platform";

const panelSizeOptions = [
  { value: "0.1", label: "10%" },
  { value: "0.15", label: "15%" },
  { value: "0.2", label: "20%" },
  { value: "0.25", label: "25%" },
  { value: "0.3", label: "30%" },
  { value: "0.35", label: "35%" },
  { value: "0.4", label: "40%" },
  { value: "0.45", label: "45%" },
  { value: "0.5", label: "50%" },
  { value: "0.6", label: "60%" },
  { value: "0.7", label: "70%" },
  { value: "0.8", label: "80%" },
];

// scrollbackOptions are raw numeric labels — no translation needed (G7/WI-4.2)
const scrollbackOptions = [
  { value: "1000", label: "1,000" },
  { value: "5000", label: "5,000" },
  { value: "10000", label: "10,000" },
  { value: "50000", label: "50,000" },
];

// fontSizeOptions are raw numeric labels — no translation needed
const fontSizeOptions = [
  { value: "10", label: "10px" },
  { value: "11", label: "11px" },
  { value: "12", label: "12px" },
  { value: "13", label: "13px" },
  { value: "14", label: "14px" },
  { value: "16", label: "16px" },
  { value: "18", label: "18px" },
  { value: "20", label: "20px" },
  { value: "24", label: "24px" },
];


/** Extract shell name from absolute path (e.g. "/bin/zsh" → "zsh", "C:\\Windows\\cmd.exe" → "cmd.exe"). */
function shellLabel(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  return name || path;
}

/** Snap a ratio to the nearest dropdown option value. */
function snapToOption(ratio: number): string {
  const values = panelSizeOptions.map((o) => Number(o.value));
  let closest = values[0];
  let minDiff = Math.abs(ratio - closest);
  for (const v of values) {
    const diff = Math.abs(ratio - v);
    if (diff < minDiff) {
      minDiff = diff;
      closest = v;
    }
  }
  return String(closest);
}

export function TerminalSettings() {
  const { t } = useTranslation("settings");
  const terminal = useSettingsStore((state) => state.terminal);
  const updateTerminalSetting = useSettingsStore((state) => state.updateTerminalSetting);

  // Platform gating (D1): `macOptionIsMeta` is genuinely macOS-only (the
  // Option/Meta tradeoff only exists on macOS). `shellIntegration` injects
  // OSC marks for Unix shells (zsh) — keep it on macOS and Linux, hide on
  // Windows where it does not apply.
  const isMac = isMacPlatform();
  const isWindows = isWindowsPlatform();

  const [shells, setShells] = useState<string[]>([]);
  const [defaultShell, setDefaultShell] = useState<string>("");
  const [shellsLoaded, setShellsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>("list_available_shells").then((result) => {
      if (!cancelled) {
        setShells(result);
        setShellsLoaded(true);
      }
    }).catch((e) => {
      terminalSettingsWarn(" Failed to list shells:", e);
      if (!cancelled) setShellsLoaded(true);
    });
    invoke<string>("get_default_shell").then((result) => {
      if (!cancelled) setDefaultShell(result);
    }).catch((e) => {
      terminalSettingsWarn(" Failed to get default shell:", e);
    });
    return () => { cancelled = true; };
  }, []);

  const detectedOptions = shells.map((s) => ({ value: s, label: shellLabel(s) }));
  // Case-insensitive match for Windows path compatibility
  const shellInList = shells.some((s) => s.toLowerCase() === terminal.shell.toLowerCase());
  const shellOptions = [
    {
      value: "",
      label: defaultShell
        ? t("terminal.shell.systemDefaultNamed", { name: shellLabel(defaultShell) })
        : t("terminal.shell.systemDefault"),
    },
    ...detectedOptions,
    // If persisted shell is not in detected list AND shells have finished loading,
    // show unavailable fallback. While still loading, show the persisted value
    // with its plain label to avoid a flash of "(unavailable)".
    ...(terminal.shell && !shellInList
      ? [{
          value: terminal.shell,
          label: shellsLoaded
            ? t("terminal.shell.unavailable", { name: shellLabel(terminal.shell) })
            : shellLabel(terminal.shell),
        }]
      : []),
  ];

  const positionOptions = [
    { value: "auto", label: t("terminal.panelPosition.auto") },
    { value: "top", label: t("terminal.panelPosition.top") },
    { value: "bottom", label: t("terminal.panelPosition.bottom") },
    { value: "left", label: t("terminal.panelPosition.left") },
    { value: "right", label: t("terminal.panelPosition.right") },
  ];

  const cursorStyleOptions = [
    { value: "bar", label: t("terminal.cursorStyle.bar") },
    { value: "block", label: t("terminal.cursorStyle.block") },
    { value: "underline", label: t("terminal.cursorStyle.underline") },
  ];

  const lineHeightOptions = [
    { value: "1.0", label: t("terminal.lineHeight.tight") },
    { value: "1.2", label: t("terminal.lineHeight.compact") },
    { value: "1.4", label: t("terminal.lineHeight.normal") },
    { value: "1.6", label: t("terminal.lineHeight.relaxed") },
    { value: "1.8", label: t("terminal.lineHeight.spacious") },
    { value: "2.0", label: t("terminal.lineHeight.extra") },
  ];

  return (
    <div className="space-y-6">
      <SettingsGroup title={t("terminal.group.terminal")}>
        <SettingRow label={t("terminal.shell.label")} description={t("terminal.shell.description")}>
          <Select
            value={terminal.shell}
            options={shellOptions}
            onChange={(v) => updateTerminalSetting("shell", v)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.panelPosition.label")} description={t("terminal.panelPosition.description")}>
          <Select
            value={terminal.position}
            options={positionOptions}
            onChange={(v) => updateTerminalSetting("position", v as TerminalPosition)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.panelSize.label")} description={t("terminal.panelSize.description")}>
          <Select
            value={snapToOption(terminal.panelRatio)}
            options={panelSizeOptions}
            onChange={(v) => updateTerminalSetting("panelRatio", Number(v))}
          />
        </SettingRow>

        <SettingRow label={t("terminal.fontSize.label")} description={t("terminal.fontSize.description")}>
          <Select
            value={String(terminal.fontSize)}
            options={fontSizeOptions}
            onChange={(v) => updateTerminalSetting("fontSize", Number(v))}
          />
        </SettingRow>

        <SettingRow label={t("terminal.lineHeight.label")} description={t("terminal.lineHeight.description")}>
          <Select
            value={String(terminal.lineHeight)}
            options={lineHeightOptions}
            onChange={(v) => updateTerminalSetting("lineHeight", Number(v))}
          />
        </SettingRow>

        <SettingRow label={t("terminal.cursorStyle.label")} description={t("terminal.cursorStyle.description")}>
          <Select
            value={terminal.cursorStyle}
            options={cursorStyleOptions}
            onChange={(v) => updateTerminalSetting("cursorStyle", v as TerminalCursorStyle)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.cursorBlink.label")} description={t("terminal.cursorBlink.description")}>
          <Toggle
            checked={terminal.cursorBlink}
            onChange={(v) => updateTerminalSetting("cursorBlink", v)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.copyOnSelect.label")} description={t("terminal.copyOnSelect.description")}>
          <Toggle
            checked={terminal.copyOnSelect}
            onChange={(v) => updateTerminalSetting("copyOnSelect", v)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.webgl.label")} description={t("terminal.webgl.description")}>
          <Toggle
            checked={terminal.useWebGL}
            onChange={(v) => updateTerminalSetting("useWebGL", v)}
          />
        </SettingRow>

        {isMac && (
          <SettingRow label={t("terminal.macOptionIsMeta.label")} description={t("terminal.macOptionIsMeta.description")}>
            <Toggle
              checked={terminal.macOptionIsMeta}
              onChange={(v) => updateTerminalSetting("macOptionIsMeta", v)}
            />
          </SettingRow>
        )}

        {!isWindows && (
          <SettingRow label={t("terminal.shellIntegration.label")} description={t("terminal.shellIntegration.description")}>
            <Toggle
              checked={terminal.shellIntegration}
              onChange={(v) => updateTerminalSetting("shellIntegration", v)}
            />
          </SettingRow>
        )}

        <SettingRow label={t("terminal.scrollback.label")} description={t("terminal.scrollback.description")}>
          <Select
            value={String(terminal.scrollback)}
            options={scrollbackOptions}
            onChange={(v) => updateTerminalSetting("scrollback", Number(v))}
          />
        </SettingRow>

        <SettingRow label={t("terminal.screenReaderMode.label")} description={t("terminal.screenReaderMode.description")}>
          <Toggle
            checked={terminal.screenReaderMode}
            onChange={(v) => updateTerminalSetting("screenReaderMode", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("terminal.group.accessibility")}>
        <SettingRow label={t("terminal.bellMode.label")} description={t("terminal.bellMode.description")}>
          <Select<TerminalBellMode>
            value={terminal.bellMode ?? "visual"}
            options={[
              { value: "off", label: t("terminal.bellMode.off") },
              { value: "visual", label: t("terminal.bellMode.visual") },
              { value: "audible", label: t("terminal.bellMode.audible") },
            ]}
            onChange={(v) => updateTerminalSetting("bellMode", v)}
          />
        </SettingRow>

        <SettingRow label={t("terminal.contrast.label")} description={t("terminal.contrast.description")}>
          <Select
            value={String(terminal.minimumContrastRatio ?? 4.5)}
            options={[
              { value: "1", label: t("terminal.contrast.off") },
              { value: "4.5", label: t("terminal.contrast.aa") },
              { value: "7", label: t("terminal.contrast.aaa") },
              { value: "21", label: t("terminal.contrast.max") },
            ]}
            onChange={(v) => updateTerminalSetting("minimumContrastRatio", Number(v))}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

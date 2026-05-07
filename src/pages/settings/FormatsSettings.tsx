/**
 * Format Support Settings
 *
 * Opt-in toggles for non-default format adapters and the explicit
 * external-editor command for the read-only code-tab escape hatch.
 *
 * Markdown, plain text, and YAML/YML are always registered (markdown is
 * the core product; YAML shipped on by default in the previous release
 * with the GHA workflow viewer). Every other adapter — JSON / TOML,
 * Mermaid / SVG, HTML, code viewers — is OFF by default so existing
 * users aren't surprised on upgrade.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { imeToast as toast } from "@/utils/imeToast";
import { SettingRow, SettingsGroup, Toggle, Button, SearchInput } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";

export function FormatsSettings() {
  const { t } = useTranslation("settings");
  const formats = useSettingsStore((s) => s.formats);
  const updateFormatsSetting = useSettingsStore((s) => s.updateFormatsSetting);
  const editorLabelId = useId();
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const [editorDraft, setEditorDraft] = useState(formats.externalEditor);

  // Keep the local draft in sync with the store when (a) settings reset,
  // (b) cross-window settings sync flips externalEditor, or (c) Reset
  // Settings runs. Only push the store's value into the draft when the
  // input isn't focused, so we never clobber an active edit.
  useEffect(() => {
    if (
      formats.externalEditor !== editorDraft &&
      document.activeElement !== editorInputRef.current
    ) {
      setEditorDraft(formats.externalEditor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.externalEditor]);

  const browseForEditor = async () => {
    let picked: string | string[] | null = null;
    try {
      // On macOS, Tauri's dialog plugin treats `.app` bundles as
      // selectable file packages even with `directory: false` — the
      // OS-level file-package metadata is what matters, not whether we
      // ask for a "directory". Linux/Windows users typically pick a
      // binary (also `directory: false`).
      picked = await openDialog({
        directory: false,
        multiple: false,
        title: t("formats.externalEditor.dialogTitle"),
      });
    } catch (error) {
      // The Tauri dialog plugin only throws on real failures (permission
      // denied, plugin not initialized). User-cancel returns null without
      // throwing — surface the unexpected ones instead of swallowing.
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      return;
    }
    if (typeof picked === "string" && picked.length > 0) {
      // Browse always returns an absolute path; the Rust validator
      // accepts absolute paths with whitespace as long as they exist
      // on disk (and Browse can only return real paths). So no extra
      // frontend validation needed here.
      setEditorDraft(picked);
      updateFormatsSetting("externalEditor", picked);
    }
  };

  const commitEditorDraft = () => {
    if (editorDraft !== formats.externalEditor) {
      updateFormatsSetting("externalEditor", editorDraft);
    }
  };

  return (
    <div>
      <SettingsGroup title={t("formats.group.support")}>
        <div className="text-xs text-[var(--text-tertiary)] py-1">
          {t("formats.group.supportDescription")}
        </div>
        <SettingRow
          label={t("formats.dataFormats.label")}
          description={t("formats.dataFormats.description")}
        >
          <Toggle
            checked={formats.dataFormats}
            onChange={(v) => updateFormatsSetting("dataFormats", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("formats.diagrams.label")}
          description={t("formats.diagrams.description")}
        >
          <Toggle
            checked={formats.diagrams}
            onChange={(v) => updateFormatsSetting("diagrams", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("formats.htmlPreview.label")}
          description={t("formats.htmlPreview.description")}
        >
          <Toggle
            checked={formats.htmlPreview}
            onChange={(v) => updateFormatsSetting("htmlPreview", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("formats.codeViewers.label")}
          description={t("formats.codeViewers.description")}
        >
          <Toggle
            checked={formats.codeViewers}
            onChange={(v) => updateFormatsSetting("codeViewers", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("formats.group.tooling")}>
        <div className="text-xs text-[var(--text-tertiary)] py-1">
          {t("formats.group.toolingDescription")}
        </div>
        <div className="py-2.5">
          <div
            id={editorLabelId}
            className="text-sm font-medium text-[var(--text-primary)] mb-1"
          >
            {t("formats.externalEditor.label")}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] mb-2">
            {t("formats.externalEditor.description")}
          </div>
          <div className="flex items-end gap-2">
            <SearchInput
              value={editorDraft}
              onChange={setEditorDraft}
              onBlur={commitEditorDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEditorDraft();
                }
              }}
              placeholder={t("formats.externalEditor.placeholder")}
              mono
              className="flex-1"
              aria-labelledby={editorLabelId}
              ref={editorInputRef}
            />
            <Button onClick={browseForEditor} variant="secondary">
              {t("formats.externalEditor.browse")}
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}

/**
 * FontSettingRow — one font role (Latin / CJK / Mono) in Settings (#1429).
 *
 * Purpose: VMark's font choices were a CLOSED list. A user who installed
 * anything else — LXGW WenKai / 霞鹜文楷 in the report — had no way to reach
 * it, and nothing on screen said the list was the limit. This row keeps the
 * curated shortlist, adds every family installed on the machine, and accepts
 * a typed family name for the platforms VMark cannot enumerate.
 *
 * Key decisions:
 *   - **The current family is always in the list, installed or not.** A
 *     `<select>` whose value matches no option renders BLANK, which is what a
 *     Windows user (no enumeration) or anyone who uninstalled a font would
 *     otherwise see — a picker that looks broken while holding a correct
 *     value.
 *   - **A rejected draft stays local.** Committing every keystroke would
 *     apply a half-typed family; committing an unusable one is worse, because
 *     the setting resolves back to null and the field the user is typing into
 *     would empty itself under them. Only a name that survives
 *     `sanitizeCustomFontFamily` reaches the store — and it reaches it
 *     immediately, so the document re-renders in the new font as soon as the
 *     name is complete.
 *   - **"Custom…" applies nothing by itself.** Picking it reveals the field;
 *     the setting changes when a usable name exists, never before, so there
 *     is no intermediate state in which the user's font has been taken away.
 *
 * @coordinates-with utils/fontStacks.ts — the encoding and the one validator
 * @coordinates-with hooks/useSystemFontFamilies.ts — the installed list
 * @module pages/settings/FontSettingRow
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow, Select, FieldInput } from "./components";
import {
  customFontValue,
  parseCustomFont,
  sanitizeCustomFontFamily,
} from "@/utils/customFont";

/** The "type a family name" entry. Deliberately not a valid setting value —
 *  it is a UI mode, and it never reaches the store. */
const CUSTOM_OPTION = "__custom__";

export interface FontSettingRowProps {
  label: string;
  /** The stored setting: a curated key, or `custom:<family>`. */
  value: string;
  /** Curated keys for this role; `label: null` means the system default. */
  options: readonly { value: string; label: string | null }[];
  systemDefaultLabel: string;
  /** Families installed on this machine; empty where VMark cannot enumerate. */
  installed: readonly string[];
  onChange: (value: string) => void;
}

export function FontSettingRow({
  label,
  value,
  options,
  systemDefaultLabel,
  installed,
  onChange,
}: FontSettingRowProps) {
  const { t } = useTranslation("settings");
  const listId = useId();
  const customFamily = parseCustomFont(value);
  const [wantsCustom, setWantsCustom] = useState(false);
  const [draft, setDraft] = useState(customFamily ?? "");
  const showCustom = wantsCustom || customFamily !== null;

  // Memoized because the backend list runs to a few hundred families and this
  // row re-renders on every keystroke in the field below — `localeCompare`
  // over 300 entries three times per character is real, avoidable work.
  const families = useMemo(
    () =>
      Array.from(
        new Set(customFamily === null ? installed : [customFamily, ...installed]),
      ).sort((a, b) => a.localeCompare(b)),
    [customFamily, installed],
  );

  const handleSelect = (next: string) => {
    if (next === CUSTOM_OPTION) {
      setWantsCustom(true);
      return;
    }
    setWantsCustom(false);
    setDraft(parseCustomFont(next) ?? "");
    onChange(next);
  };

  const handleDraft = (next: string) => {
    setDraft(next);
    const family = sanitizeCustomFontFamily(next);
    if (family) onChange(customFontValue(family));
  };

  // A draft that cannot be used SAYS so. Without this the row goes quiet: the
  // last usable prefix stays applied while the field shows something longer,
  // and the only symptom is a font that stopped following what is on screen.
  const draftRejected = draft.trim() !== "" && sanitizeCustomFontFamily(draft) === null;

  return (
    <>
      <SettingRow label={label}>
        <Select
          value={customFamily === null && showCustom ? CUSTOM_OPTION : value}
          options={[
            ...options.map((o) => ({ value: o.value, label: o.label ?? systemDefaultLabel })),
            { value: CUSTOM_OPTION, label: t("editor.font.custom") },
          ]}
          groups={
            families.length === 0
              ? []
              : [
                  {
                    label: t("editor.font.installed"),
                    options: families.map((family) => ({
                      value: customFontValue(family),
                      label: family,
                    })),
                  },
                ]
          }
          onChange={handleSelect}
        />
      </SettingRow>
      {showCustom && (
        <SettingRow
          label={t("editor.font.customFamily.label")}
          description={
            draftRejected
              ? t("editor.font.customFamily.invalid")
              : t("editor.font.customFamily.description")
          }
        >
          <FieldInput
            value={draft}
            onChange={handleDraft}
            list={listId}
            mono={false}
            spellCheck={false}
            placeholder={t("editor.font.customFamily.placeholder")}
          />
        </SettingRow>
      )}
      {/* Always attached, even when empty. An `<input list=…>` is a combobox
          and one without is a textbox, so attaching it conditionally would
          change the control's accessible ROLE as the family list arrives —
          a live role change under a screen reader, on the same field. */}
      <datalist id={listId}>
        {families.map((family) => (
          <option key={family} value={family} />
        ))}
      </datalist>
    </>
  );
}

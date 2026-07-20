/**
 * Coherence settings — currently just τ, the semantic-check confidence
 * threshold.
 *
 * τ decides whether a check's answer is recorded as a verdict or downgraded to
 * `unknown`. It shipped as a store value with a 0.9 default and no control, so
 * nobody could move it — and the dogfood run's most frequent complaint (checks
 * returning `unknown` while the model's actual answer was discarded) is the
 * direct symptom of a threshold set too high for the corpus with no way to
 * lower it.
 *
 * Offered as a labelled few rather than a free number. τ is a probability
 * cutoff whose practical effect is non-obvious, and a numeric box invites
 * values that look precise while meaning nothing to the person choosing. The
 * options stay inside clamp.ts's [0.5, 1] — an out-of-range option would be
 * silently rewritten on load, leaving the UI claiming a setting it did not make.
 *
 * @module pages/settings/CoherenceSettingsGroup
 */
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select } from "./components";

const TAU_OPTIONS = ["0.7", "0.8", "0.9", "0.95"] as const;

export function CoherenceSettingsGroup() {
  const { t } = useTranslation("settings");
  const tau = useSettingsStore((state) => state.general.coherenceCheckTau);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);

  return (
    <SettingsGroup title={t("coherence.group")}>
      <SettingRow
        label={t("coherence.checkTau.label")}
        description={t("coherence.checkTau.description")}
      >
        <Select
          value={String(tau)}
          options={TAU_OPTIONS.map((v) => ({
            value: v,
            label: t(`coherence.checkTau.option${v.replace(".", "")}`),
          }))}
          onChange={(v) => updateGeneralSetting("coherenceCheckTau", Number(v))}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

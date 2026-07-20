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
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select } from "./components";

const TAU_OPTIONS = ["0.7", "0.8", "0.9", "0.95"] as const;

/**
 * The τ choices, plus the current value if it is not one of them. `clamp.ts`
 * accepts any value in [0.5, 1] (an MCP client or an older config can set, say,
 * 0.85), and a `<Select>` whose `value` matches no option renders as an empty
 * box that silently rewrites the setting on the next change — so a stray value
 * is surfaced as its own option rather than hidden.
 */
function tauOptions(tau: number, t: TFunction): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = TAU_OPTIONS.map((v) => ({
    value: v,
    label: t(`coherence.checkTau.option${v.replace(".", "")}`),
  }));
  const current = String(tau);
  if (!opts.some((o) => o.value === current)) {
    opts.push({ value: current, label: current });
    opts.sort((a, b) => Number(a.value) - Number(b.value));
  }
  return opts;
}

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
          options={tauOptions(tau, t)}
          onChange={(v) => updateGeneralSetting("coherenceCheckTau", Number(v))}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

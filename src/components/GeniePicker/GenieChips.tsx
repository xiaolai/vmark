/**
 * Quick Action Chips
 *
 * Pre-built action buttons shown when picker is opened with filterScope: "selection".
 */

import { useTranslation } from "react-i18next";
import type { GenieDefinition } from "@/types/aiGenies";

const QUICK_ACTIONS = [
  { labelKey: "chips.polish", genieName: "polish" },
  { labelKey: "chips.condense", genieName: "condense" },
  { labelKey: "chips.grammar", genieName: "fix-grammar" },
  { labelKey: "chips.rephrase", genieName: "rephrase" },
];

interface GenieChipsProps {
  genies: GenieDefinition[];
  onSelect: (genie: GenieDefinition) => void;
}

/** Renders quick-action chip buttons for common AI genies (Polish, Condense, Grammar, Rephrase). */
export function GenieChips({ genies, onSelect }: GenieChipsProps) {
  const { t } = useTranslation("ai");
  const available = QUICK_ACTIONS.filter((action) =>
    genies.some((g) => g.metadata.name === action.genieName)
  );

  if (available.length === 0) return null;

  return (
    <div className="genie-chips">
      {available.map((action) => {
        const genie = genies.find(
          (g) => g.metadata.name === action.genieName
        );
        /* v8 ignore next -- @preserve defensive guard: available was pre-filtered so genie always exists */
        if (!genie) return null;
        return (
          <button
            key={action.genieName}
            className="vm-chip genie-chip"
            onClick={() => onSelect(genie)}
            type="button"
          >
            {t(action.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

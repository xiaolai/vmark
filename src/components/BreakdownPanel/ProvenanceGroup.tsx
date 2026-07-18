/**
 * ProvenanceGroup (WI-3.2) — the breakdown's "provenance unknown"
 * section: orphaned-but-recoverable artifacts with the lazy
 * suggest → checkbox → confirm flow (design-3.md D1.5). Pull-only:
 * nothing here nags; the group renders only when candidates exist.
 *
 * @module components/BreakdownPanel/ProvenanceGroup
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useBreakdownStore,
  type ProposedInput,
  type ProvenanceCandidate,
} from "@/stores/breakdownStore";
import {
  confirmInputs,
  proposeInputs,
} from "@/services/breakdown/breakdownService";

function CandidateRow({
  candidate,
  workspaceRoot,
}: {
  candidate: ProvenanceCandidate;
  workspaceRoot: string;
}) {
  const { t } = useTranslation("breakdown");
  const [proposal, setProposal] = useState<{
    head: string;
    inputs: ProposedInput[];
  } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const suggest = () => {
    if (busy) return;
    setBusy(true);
    void proposeInputs(workspaceRoot, candidate.path)
      .then((p) => {
        if (p) {
          setProposal(p);
          setChecked(Object.fromEntries(p.inputs.map((i) => [i.path, true])));
        }
      })
      .finally(() => setBusy(false));
  };

  const confirm = () => {
    if (!proposal || busy) return;
    const inputs = proposal.inputs.filter((i) => checked[i.path]);
    if (inputs.length === 0) return;
    setBusy(true);
    setProposal(null);
    void confirmInputs(workspaceRoot, candidate.path, proposal.head, inputs).finally(
      () => setBusy(false),
    );
  };

  return (
    <li className="provenance-row">
      <div className="provenance-row__main">
        <span className="provenance-row__path" title={candidate.path}>
          {candidate.path}
        </span>
        <span className="provenance-row__hint">
          {t("provenance.hint", { count: candidate.proposed })}
        </span>
        <button
          type="button"
          className="breakdown-row__action"
          onClick={suggest}
          disabled={busy || !workspaceRoot}
          aria-expanded={proposal !== null}
        >
          {t("provenance.suggest")}
        </button>
      </div>
      {proposal && (
        <div className="provenance-row__confirm">
          {proposal.inputs.map((input) => (
            <label key={input.path} className="provenance-row__input">
              <input
                type="checkbox"
                checked={checked[input.path] ?? false}
                onChange={(e) =>
                  setChecked((c) => ({ ...c, [input.path]: e.target.checked }))
                }
              />
              <span>{input.path}</span>
              <span className="provenance-row__role">{input.role}</span>
            </label>
          ))}
          <button
            type="button"
            className="breakdown-row__action"
            onClick={confirm}
            disabled={busy || proposal.inputs.every((i) => !checked[i.path])}
          >
            {t("provenance.confirm")}
          </button>
        </div>
      )}
    </li>
  );
}

export function ProvenanceGroup({ workspaceRoot }: { workspaceRoot: string | null }) {
  const { t } = useTranslation("breakdown");
  const candidates = useBreakdownStore((s) => s.provenance);
  if (candidates.length === 0 || !workspaceRoot) return null;
  return (
    <section className="provenance-group">
      <h3 className="provenance-group__heading">{t("provenance.heading")}</h3>
      <ul className="provenance-group__list">
        {candidates.map((c) => (
          <CandidateRow key={c.path} candidate={c} workspaceRoot={workspaceRoot} />
        ))}
      </ul>
    </section>
  );
}

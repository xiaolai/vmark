/**
 * DelegationsSection (WI-3.4) — live agent delegations with explicit
 * grant/revoke acts (design-3.md D2.2): 7-day default, never forever,
 * a confirmation dialog naming principal, scope, and expiry before
 * anything is recorded.
 *
 * @module components/BreakdownPanel/DelegationsSection
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { useBreakdownStore } from "@/stores/breakdownStore";
import { delegate } from "@/services/breakdown/semanticActs";

const DEFAULT_DAYS = 7;

export function DelegationsSection({ workspaceRoot }: { workspaceRoot: string | null }) {
  const { t } = useTranslation("breakdown");
  const rows = useBreakdownStore((s) => s.delegations);
  const [principal, setPrincipal] = useState("");
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [acceptNewer, setAcceptNewer] = useState(true);
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    const trimmed = principal.trim();
    const scope = [
      ...(acceptNewer ? ["resolve.accept-newer"] : []),
      ...(waive ? ["resolve.waive"] : []),
    ];
    // Strict decimal integer, bounded to a sane maximum — "7days" must
    // not parse as 7, and a huge value must not make toISOString() throw
    // an unhandled rejection (audit D11).
    const MAX_DAYS = 365;
    if (!workspaceRoot || busy || trimmed === "" || scope.length === 0) return;
    if (!/^\d+$/.test(days.trim())) return;
    const parsedDays = Number.parseInt(days, 10);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > MAX_DAYS)
      return;
    const expires = new Date(
      Date.now() + parsedDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    // D2.2/D4.3 posture: nothing is recorded without the explicit
    // confirmation naming principal, scope, and expiry.
    const confirmed = await ask(
      t("delegations.grantConfirm", {
        principal: trimmed,
        scope: scope.join(", "),
        date: expires.slice(0, 10),
      }),
      { title: t("delegations.grantTitle"), kind: "warning" },
    );
    if (!confirmed) return;
    setBusy(true);
    setPrincipal("");
    await delegate(workspaceRoot, { delegate: trimmed, scope, expires });
    setBusy(false);
  };

  const revoke = async (grantId: string, delegatePrincipal: string) => {
    if (!workspaceRoot || busy) return;
    setBusy(true);
    // A revocation's expires is inert (scope is empty; the kernel skips
    // future-validation on revokes) — a fixed sentinel keeps this pure.
    await delegate(workspaceRoot, {
      delegate: delegatePrincipal,
      scope: [],
      expires: "9999-12-31T23:59:59Z",
      revoke: grantId,
    });
    setBusy(false);
  };

  if (!workspaceRoot) return null;
  return (
    <section className="delegations-section">
      <h4 className="delegations-section__heading">{t("delegations.heading")}</h4>
      {rows.length === 0 && (
        <div className="delegations-section__empty">{t("delegations.empty")}</div>
      )}
      {rows.length > 0 && (
        <ul className="delegations-section__list">
          {rows.map((row) => (
            <li key={row.grant} className="delegations-section__row">
              <span className="delegations-section__principal">{row.delegate}</span>
              <span className="delegations-section__scope">
                {row.scope.join(", ")}
              </span>
              <span className="delegations-section__expires">
                {t("delegations.expiresOn", { date: row.expires.slice(0, 10) })}
              </span>
              <button
                type="button"
                className="breakdown-row__action"
                onClick={() => void revoke(row.grant, row.delegate)}
                disabled={busy}
              >
                {t("delegations.revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="delegations-section__form">
        <input
          type="text"
          className="delegations-section__input"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          placeholder={t("delegations.principalPlaceholder")}
          aria-label={t("delegations.principalPlaceholder")}
        />
        <label className="delegations-section__scope-box">
          <input
            type="checkbox"
            checked={acceptNewer}
            onChange={(e) => setAcceptNewer(e.target.checked)}
          />
          {t("delegations.scopeAcceptNewer")}
        </label>
        <label className="delegations-section__scope-box">
          <input
            type="checkbox"
            checked={waive}
            onChange={(e) => setWaive(e.target.checked)}
          />
          {t("delegations.scopeWaive")}
        </label>
        <label className="delegations-section__days-label">
          {t("delegations.days")}
          <input
            type="text"
            className="delegations-section__days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-label={t("delegations.days")}
          />
        </label>
        <button
          type="button"
          className="breakdown-row__action"
          onClick={() => void grant()}
          disabled={
            busy || principal.trim() === "" || (!acceptNewer && !waive)
          }
        >
          {t("delegations.grant")}
        </button>
      </div>
    </section>
  );
}

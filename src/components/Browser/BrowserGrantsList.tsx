/**
 * BrowserGrantsList — see and revoke the standing permissions the AI holds (WI-S0.8).
 *
 * Purpose: "Allow on this site" in the approval prompt mints standing authority for an
 * origin, and a permission model without revocation is not a permission model. This is
 * the surface that shows what has been granted and takes it back.
 *
 * Scope: grants live in memory only — they are never written to disk, so they lapse
 * when VMark quits. That is deliberate. Persisting "the AI may click on this site" across
 * restarts is a real escalation of authority, and it should be an explicit, separately
 * reviewed decision rather than a side effect of the store having a `grants` array. The
 * copy says so rather than letting the user assume otherwise.
 *
 * Revoking is immediate: `revoke()` drops the origin from the store, `grantSync` pushes
 * the shortened grant vector to the Rust driver (which replaces its whole mirror), and
 * the driver refuses the next operation on that origin.
 *
 * @coordinates-with stores/browserApprovalStore — grants + revoke
 * @coordinates-with services/browser/grantSync — mirrors the grant vector into Rust
 * @module components/Browser/BrowserGrantsList
 */
import { useTranslation } from "react-i18next";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import "./browser-grants-list.css";

export function BrowserGrantsList(): React.ReactElement {
  const { t } = useTranslation("common");
  const grants = useBrowserApprovalStore((s) => s.grants);

  if (grants.length === 0) {
    return <p className="browser-grants-empty">{t("browser.grants.empty")}</p>;
  }

  return (
    <ul className="browser-grants">
      {grants.map((grant) => (
        <li key={grant.originPattern} className="browser-grants-row">
          <div className="browser-grants-origin-block">
            <span className="browser-grants-origin">{grant.originPattern}</span>
            <span className="browser-grants-ops">
              {grant.operations.map((op) => t(`browser.approval.operation.${op}`, op)).join(", ")}
            </span>
          </div>
          <button
            type="button"
            className="browser-grants-revoke"
            aria-label={t("browser.grants.revokeLabel", { origin: grant.originPattern })}
            onClick={() => useBrowserApprovalStore.getState().revoke(grant.originPattern)}
          >
            {t("browser.grants.revoke")}
          </button>
        </li>
      ))}
    </ul>
  );
}

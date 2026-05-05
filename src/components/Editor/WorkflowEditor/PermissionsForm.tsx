/**
 * Purpose: WI-C.3 — workflow-level permissions editor. The
 *   IR's `permissions` field can be one of:
 *     - undefined (default — github-token's default scopes)
 *     - "read-all" | "write-all" | "none" (string shorthand)
 *     - per-scope mapping ({ contents: "read", "pull-requests": "write" })
 *
 *   This form exposes the simple-string mode + a hand-rolled "custom"
 *   panel for the most common scopes. Power users (rare scope edits)
 *   continue to drop to source.
 *
 * @coordinates-with src/lib/ghaWorkflow/save/mutators.ts — workflow.permissions.set patch
 * @module components/Editor/WorkflowEditor/PermissionsForm
 */

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionsValue } from "@/lib/ghaWorkflow/types";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import "./workflow-editor.css";

interface PermissionsFormProps {
  permissions: PermissionsValue | undefined;
}

type PresetMode = "default" | "read-all" | "write-all" | "none" | "custom";

const COMMON_SCOPES: readonly string[] = [
  "contents",
  "pull-requests",
  "issues",
  "actions",
  "checks",
  "deployments",
  "id-token",
  "packages",
  "statuses",
];

function permissionsToMode(
  perms: PermissionsValue | undefined,
): PresetMode {
  if (perms === undefined) return "default";
  if (perms === "read-all" || perms === "write-all" || perms === "none") {
    return perms;
  }
  return "custom";
}

export function PermissionsForm({
  permissions,
}: PermissionsFormProps): ReactElement {
  const { t } = useTranslation("workflowEditor");
  const queue = useWorkflowEditStore((s) => s.queuePatch);
  const [mode, setMode] = useState<PresetMode>(() =>
    permissionsToMode(permissions),
  );

  const customMap: Record<string, "read" | "write" | "none"> =
    typeof permissions === "object" && permissions !== null
      ? Object.fromEntries(
          Object.entries(permissions as Record<string, string>).map(
            ([k, v]) => [k, v as "read" | "write" | "none"],
          ),
        )
      : {};

  const onModeChange = (next: PresetMode): void => {
    setMode(next);
    if (next === "default") {
      // Delete the permissions key to restore GitHub's default
      // behavior. Codex audit HIGH-1 fix — empty string was getting
      // serialized as `permissions: ""` which is invalid.
      queue({ kind: "workflow.permissions.set", value: null });
      return;
    }
    if (next === "custom") {
      queue({ kind: "workflow.permissions.set", value: customMap });
      return;
    }
    queue({ kind: "workflow.permissions.set", value: next });
  };

  const onScopeChange = (
    scope: string,
    value: "read" | "write" | "none" | "",
  ): void => {
    const next = { ...customMap };
    if (!value) delete next[scope];
    else next[scope] = value;
    queue({ kind: "workflow.permissions.set", value: next });
  };

  return (
    <section className="workflow-form workflow-form--inline">
      <header className="workflow-form__inline-header">
        <span className="workflow-form__label">
          {t("form.permissions.label", { defaultValue: "Permissions" })}
        </span>
      </header>
      <label className="workflow-form__field">
        <select
          className="workflow-form__input"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as PresetMode)}
        >
          <option value="default">
            {t("form.permissions.default", { defaultValue: "Default" })}
          </option>
          <option value="read-all">read-all</option>
          <option value="write-all">write-all</option>
          <option value="none">none</option>
          <option value="custom">
            {t("form.permissions.custom", {
              defaultValue: "Custom (per-scope)",
            })}
          </option>
        </select>
      </label>
      {mode === "custom" && (
        <div className="workflow-form__permissions-scopes">
          {COMMON_SCOPES.map((scope) => (
            <label key={scope} className="workflow-form__permissions-scope">
              <span className="workflow-form__permissions-scope-name">
                <code>{scope}</code>
              </span>
              <select
                className="workflow-form__input"
                value={customMap[scope] ?? ""}
                onChange={(e) =>
                  onScopeChange(
                    scope,
                    e.target.value as "read" | "write" | "none" | "",
                  )
                }
              >
                <option value="">
                  {t("form.permissions.unset", { defaultValue: "(unset)" })}
                </option>
                <option value="read">read</option>
                <option value="write">write</option>
                <option value="none">none</option>
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

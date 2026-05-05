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
import type { PermissionsValue, PermLevel } from "@/lib/ghaWorkflow/types";
import {
  COMMON_SCOPES_KEBAB,
  camelToKebab,
  kebabToCamel,
} from "@/lib/ghaWorkflow/permissions/scopes";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import "./workflow-editor.css";

interface PermissionsFormProps {
  permissions: PermissionsValue | undefined;
}

type PresetMode = "default" | "read-all" | "write-all" | "none" | "custom";

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

  // The IR carries scope keys in camelCase (`pullRequests`); the
  // form displays them in kebab-case (the on-disk YAML form). We
  // convert both ways through scopes.ts (Codex audit HIGH-2 fix).
  // `customMap` is keyed by kebab so direct lookup works in the
  // render below.
  const customMap: Record<string, PermLevel> =
    typeof permissions === "object" && permissions !== null
      ? Object.fromEntries(
          Object.entries(permissions as Record<string, PermLevel>).map(
            ([camelOrKebab, v]) => [camelToKebab(camelOrKebab), v],
          ),
        )
      : {};

  const queueCustomMap = (yamlMap: Record<string, PermLevel>): void => {
    // Mutator expects whatever-shape the user wants serialized — and
    // the parser/mutator round-trip through kebab-case YAML keys. We
    // keep the patch in IR-shape (camelCase) so the save pipeline
    // is symmetric with reads.
    const irShape: Record<string, PermLevel> = {};
    for (const [k, v] of Object.entries(yamlMap)) {
      irShape[kebabToCamel(k)] = v;
    }
    queue({ kind: "workflow.permissions.set", value: irShape });
  };

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
      queueCustomMap(customMap);
      return;
    }
    queue({ kind: "workflow.permissions.set", value: next });
  };

  const onScopeChange = (
    scope: string,
    value: PermLevel | "",
  ): void => {
    const next = { ...customMap };
    if (!value) delete next[scope];
    else next[scope] = value;
    queueCustomMap(next);
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
          {COMMON_SCOPES_KEBAB.map((scope) => (
            <label key={scope} className="workflow-form__permissions-scope">
              <span className="workflow-form__permissions-scope-name">
                <code>{scope}</code>
              </span>
              <select
                className="workflow-form__input"
                value={customMap[scope] ?? ""}
                onChange={(e) =>
                  onScopeChange(scope, e.target.value as PermLevel | "")
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

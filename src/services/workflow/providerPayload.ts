/**
 * The provider block `run_workflow` takes (audit #762).
 *
 * ONE derivation of four fields from the AI provider store. There were two,
 * character-for-character identical — `workflowProviderConfig` in
 * `useGenieInvocation.ts` and an inline block in `useWorkflowExecution.start` —
 * feeding the same Tauri command from two files that never import each other.
 * Nothing would have failed if one had gained a field, or changed the empty
 * string fold, and the other had not: the workflow would just have run with a
 * different provider configuration depending on which surface started it.
 *
 * Like `workflowEnginePolicySync.ts`, this belongs to the YAML workflow engine
 * rather than to the embedded browser's run engine that dominates this folder.
 *
 * @coordinates-with hooks/useWorkflowExecution.ts — the panel's Run button
 * @coordinates-with hooks/useGenieInvocation.ts — a workflow genie's dispatch
 * @coordinates-with src-tauri/src/workflow/commands.rs — the `provider` argument
 * @module services/workflow/providerPayload
 */

import { useAiProviderStore } from "@/stores/aiStore";

/** The `provider` argument of `run_workflow`; null when no provider is active. */
export interface WorkflowProviderPayload {
  provider: string;
  apiKey: string | null;
  endpoint: string | null;
  cliPath: string | null;
}

/**
 * Build the provider block for the active provider, or null when there is none.
 *
 * `|| null`, not `?? null`: an empty string is not a configured key or
 * endpoint, and Rust reads `null` as "not set" — a `""` would be sent as a
 * credential and refused by the provider several seconds later instead.
 */
export function workflowProviderPayload(): WorkflowProviderPayload | null {
  const state = useAiProviderStore.getState();
  const active = state.activeProvider;
  if (!active) return null;

  const rest = state.restProviders.find((p) => p.type === active);
  const cli = state.cliProviders.find((p) => p.type === active);
  return {
    provider: active,
    apiKey: rest?.apiKey || null,
    endpoint: rest?.endpoint || null,
    cliPath: cli?.path || null,
  };
}

/**
 * Workspace facade — ADR-008.
 *
 * `useWorkspace()`, the aggregate read API this facade was created for, was
 * never adopted (zero production importers) and was deleted under the
 * feature-ledger plan (WI-FL3.1). What remains is the one export quick-open
 * consumes.
 */

export { useActiveWorkspaceScope } from "@/hooks/useActiveWorkspaceScope";

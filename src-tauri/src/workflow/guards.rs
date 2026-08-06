//! Feature gate for the bespoke YAML workflow engine (WI-19).
//!
//! The engine is `advanced.workflowEngine` — off by default, ~17.8k LOC, and
//! until now the backend ignored it entirely: `run_workflow` was registered
//! unconditionally and executed whatever YAML reached the IPC boundary. The
//! flag hid a button; it did not stop the runner from spawning AI providers,
//! writing files, or taking snapshots on behalf of a feature the user had
//! switched off. Anything that can invoke — the MCP bridge, a second window, a
//! replayed call — bypassed it.
//!
//! **How the backend learns the flag.** Settings live in the webview's
//! localStorage (zustand `persist` over `createSafeStorage`), which Rust cannot
//! read. So the frontend PUSHES, exactly as the embedded browser already does:
//! `browser_ai_policy` → `BrowserSurface.ai_policy`. Here it is
//! `workflow_engine_policy` → `WorkflowRunnerState.engine_enabled`, pushed once
//! at bootstrap and on every settings change by
//! `src/services/workflow/workflowEnginePolicySync.ts`. The state starts
//! `false`, so the window between app start and the first push refuses rather
//! than runs — a fail-closed default is the only safe direction for a gate whose
//! sole job is to not execute things.
//!
//! **Known consequence, deliberate.** A *workflow genie* dispatches through
//! `run_workflow` (WI-7.1) and the genie picker does not consult the flag, so
//! invoking one with the engine off now fails instead of silently running. That
//! is the intended trade: `useGenieInvocation` surfaces the rendered message
//! ("The workflow engine is turned off in Settings") through
//! `commandErrorMessage`, so the user is told what to switch on. A feature that
//! executes YAML behind a switch the user set to off is the defect, not the
//! refusal.
//!
//! Split into its own module for the same reason as `browser::ai_guards`: the
//! commands need an `AppHandle` and cannot be unit-tested, but the policy
//! decision can be, and every refusal gets a test naming its `code`.
//!
//! @coordinates-with workflow/commands.rs — the only caller
//! @coordinates-with src/services/workflow/workflowEnginePolicySync.ts — the pusher
//! @module workflow::guards

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use crate::workflow::state::WorkflowRunnerState;

/// Refuse every engine command while `advanced.workflowEngine` is off.
///
/// `FeatureDisabled` rather than a generic failure so the caller can tell
/// "turned off in Settings" from "the workflow failed": the MCP bridge reports
/// the first as actionable configuration and must not retry it.
pub(super) fn require_workflow_engine_enabled(
    state: &WorkflowRunnerState,
) -> Result<(), CommandError> {
    if state.engine_enabled() {
        Ok(())
    } else {
        Err(localized_error!(
            ErrorCode::FeatureDisabled,
            "errors.workflow.engineDisabled"
        ))
    }
}

#[cfg(test)]
#[path = "guards.test.rs"]
mod tests;

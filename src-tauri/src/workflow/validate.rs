//! What a workflow DOCUMENT must be before anything is spawned for it.
//!
//! Split from `commands.rs` at the file-size gate, and it is a real seam:
//! nothing here reads or writes the managed state. `commands.rs` owns the
//! order that matters around it — gate, then claim, then this — while this
//! half is a pure function of the YAML and the workspace root, which is what
//! lets `commands.test.rs` drive every refusal without a Tauri runtime.
//!
//! The checks run cheapest-first, and that ORDER is the point of the size
//! bound: everything below it is read off a deserialized document.
//!
//! @coordinates-with commands.rs — `admit_run`, the only caller
//! @coordinates-with prepare.rs — `reject_dynamic_save_paths`, the last check
//! @module workflow::validate

use super::types::RawWorkflow;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::path::PathBuf;

/// Largest workflow document `run_workflow` will parse (#520). A workflow is
/// a few kilobytes of YAML; the same cap `read_genie` applies to the file a
/// workflow genie is READ from, so the two halves of the same path agree.
pub(super) const MAX_WORKFLOW_YAML_BYTES: u64 = crate::genies::commands::MAX_GENIE_BYTES;

/// Everything a workflow document must satisfy before a run is prepared:
/// non-empty and bounded YAML, a real workspace root, a document that parses,
/// a step count within the ceiling, no step the runner cannot execute, a
/// dependency graph that sorts, and no save target the snapshot cannot name.
pub(super) fn validate_document(
    yaml: &str,
    workspace_root: &str,
) -> Result<(RawWorkflow, PathBuf), CommandError> {
    if yaml.trim().is_empty() {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.emptyYaml"
        ));
    }
    // Bounded BEFORE the parse (#520). Every other bound here — the 50 steps,
    // the graph check — is read off a deserialized document, so the parser has
    // already run by the time any of them can refuse: a YAML alias bomb
    // (`a: &x [...]` referenced from itself repeatedly) expands during
    // deserialization and there is nothing downstream left to catch it. The
    // cap is the one a workflow genie already passes through
    // (`genies::commands::MAX_GENIE_BYTES`), so nothing that can reach the
    // picker is refused here.
    if yaml.len() as u64 > MAX_WORKFLOW_YAML_BYTES {
        return Err(CommandError::invalid_input(format!(
            "workflow is {} bytes; the limit is {MAX_WORKFLOW_YAML_BYTES}",
            yaml.len()
        )));
    }

    // Canonical, so a relative or symlinked root reaches the sandbox as the
    // absolute path its containment checks compare against (#261).
    let workspace = std::fs::canonicalize(workspace_root)
        .ok()
        .filter(|p| p.is_dir())
        .ok_or_else(|| {
            localized_error!(
                ErrorCode::InvalidInput,
                "errors.workflow.invalidWorkspace",
                path = workspace_root
            )
        })?;

    let workflow: RawWorkflow = serde_yaml_ng::from_str(yaml).map_err(|e| {
        localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.parseFailed",
            detail = e.to_string()
        )
    })?;

    // Validate step count
    if workflow.steps.len() > 50 {
        return Err(localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.tooManySteps",
            count = workflow.steps.len().to_string()
        ));
    }

    // Validate supported features — reject only what the runner truly can't
    // handle yet. `genie/*` is supported (WI-2.2); webhooks are not.
    for (i, step) in workflow.steps.iter().enumerate() {
        let step_id = step.id.as_deref().unwrap_or("(unnamed)");
        if step.uses.starts_with("webhook/") {
            return Err(localized_error!(
                ErrorCode::Unsupported,
                "errors.workflow.webhookNotImplemented",
                index = (i + 1).to_string(),
                id = step_id
            ));
        }
    }

    // The dependency graph is validated HERE, not left to the runner (#522).
    // A duplicate id, an unknown `needs:` target or a cycle makes
    // `topological_sort` fail on the runner's FIRST line — before it emits
    // `workflow:complete` — while this command has already returned `Ok` with
    // an execution id the frontend is subscribed to. The run then neither
    // started nor finished, and the panel waited forever. Sorting the same
    // steps here means the runner's own sort can no longer be the first thing
    // that fails, and the caller learns about a malformed workflow the way it
    // learns about empty YAML: synchronously, with `invalid-input`.
    super::runner::topological_sort(workflow.steps.clone()).map_err(CommandError::invalid_input)?;

    // And a save target the pre-run snapshot cannot identify (#521/#551).
    super::prepare::reject_dynamic_save_paths(&workflow)?;

    Ok((workflow, workspace))
}

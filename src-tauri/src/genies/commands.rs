//! Tauri commands for the genies feature.

use super::parsing::parse_genie;
use super::scanning::scan_genies_dir;
use super::types::{GenieContent, GenieEntry, GenieIoSpec, GenieMetadata};
use crate::bounded_read::{read_regular_bounded, BoundedReadError};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};

/// Largest genie file `read_genie` will load. A genie is a prompt template of
/// a few kilobytes; without a cap a crafted multi-megabyte file in the genies
/// directory was read whole on the IPC thread (#148).
pub(crate) const MAX_GENIE_BYTES: u64 = 1024 * 1024;

/// Return the global genies directory path.
pub fn global_genies_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_paths::app_data_dir(app)?.join("genies"))
}

/// Run a directory walk or a file read on the blocking pool (#144, #148).
///
/// Both commands used to be synchronous, which on Tauri means inline on the
/// thread that delivered the IPC message: a large genie tree or a large
/// genie file stalled every window's commands for the duration. The walk is
/// bounded (`scanning.rs`) and the read is capped, so the work is finite —
/// and now it is also off the IPC thread.
async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CommandError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| CommandError::internal(format!("genie task did not complete: {e}")))
}

/// Return the global genies directory path (Tauri command). A platform that
/// cannot resolve its app-data directory is `internal` — the same class
/// `read_genie` reports for that failure (#142).
#[command]
pub fn get_genies_dir(app: AppHandle) -> Result<String, CommandError> {
    let dir = global_genies_dir(&app).map_err(CommandError::internal)?;
    Ok(dir.to_string_lossy().to_string())
}

/// List all available genies from the global genies directory.
#[command]
pub async fn list_genies(app: AppHandle) -> Result<Vec<GenieEntry>, CommandError> {
    let global_dir = global_genies_dir(&app).map_err(CommandError::internal)?;
    off_thread(move || list_genies_in(&global_dir)).await
}

/// The scan behind `list_genies`, against an explicit directory: bounded in
/// depth and entry count by `scan_genies_dir` (#144), sorted by name.
fn list_genies_in(global_dir: &Path) -> Vec<GenieEntry> {
    let mut by_name: HashMap<String, GenieEntry> = HashMap::new();
    if global_dir.is_dir() {
        scan_genies_dir(global_dir, global_dir, "global", &mut by_name);
    }
    let mut entries: Vec<GenieEntry> = by_name.into_values().collect();
    // Path breaks a name tie (#341): the display name is the file STEM, so
    // `writing/summarize.md` and `code/summarize.md` sort equal — and the
    // remaining order was `HashMap` iteration order, which differs between
    // runs of the same process, let alone between machines.
    entries.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    entries
}

/// Read a single genie file — parse frontmatter and return metadata + template.
///
/// Markdown genies parse as before (frontmatter → metadata + template body).
/// YAML workflow genies (`.yml`/`.yaml`) parse the top-level `name` and
/// `description` for picker display; the `template` field carries the full
/// raw YAML so the runner can submit it via `run_workflow`. WI-7.1.
///
/// Validates the path is within the global genies directory to prevent
/// traversal. Typed refusals (#147): a path outside the directory is
/// `permission-denied`, a vanished file `not-found`, an unreadable one `io`,
/// and a file that is not a genie `invalid-input`.
#[command]
pub async fn read_genie(app: AppHandle, path: String) -> Result<GenieContent, CommandError> {
    let dir = global_genies_dir(&app).map_err(CommandError::internal)?;
    off_thread(move || read_genie_in(&dir, &path)).await?
}

/// `read_genie` against an explicit genies directory: the traversal guard and
/// the parse dispatch, with the `AppHandle` resolution kept in the command so
/// the refusals can be exercised on a temp tree.
fn read_genie_in(genies_dir: &Path, path: &str) -> Result<GenieContent, CommandError> {
    // Canonicalize requested path. The OS's class travels (#344): every
    // failure here used to be `not-found`, so a genie inside an unreadable
    // directory reported the one diagnosis that was ruled out — while the
    // SAME file vanishing one step later, during the read, came back as `io`.
    // Both go through `CommandError::from_io` now, so the contract this
    // function's doc states holds on either path.
    let requested = fs::canonicalize(path)
        .map_err(|e| CommandError::from_io(&e, format!("Invalid genie path {path}: {e}")))?;

    // Validate path is within the global genies directory
    let global_dir = fs::canonicalize(genies_dir).map_err(|e| {
        CommandError::internal(format!(
            "Genies directory does not exist or is inaccessible: {e}"
        ))
    })?;

    if !requested.starts_with(&global_dir) {
        return Err(localized_error!(
            ErrorCode::PermissionDenied,
            "errors.genie.pathBlocked"
        ));
    }

    // Opened, then checked and read through the SAME handle (#148): the type
    // and the size come from the open file, and the cap holds on the bytes
    // read — so a file swapped for a FIFO, or one that grows after any earlier
    // look at its metadata, cannot get past the check that was made.
    let bytes = read_regular_bounded(&requested, MAX_GENIE_BYTES).map_err(|e| match e {
        BoundedReadError::NotRegular => {
            CommandError::invalid_input(format!("Genie path {path} is not a file"))
        }
        BoundedReadError::TooLarge { limit } => CommandError::invalid_input(format!(
            "Genie file {path} is too large (max {limit} bytes)"
        )),
        BoundedReadError::Io(e) => {
            CommandError::from_io(&e, format!("Failed to read genie file {path}: {e}"))
        }
    })?;
    let content = String::from_utf8(bytes)
        .map_err(|e| CommandError::invalid_input(format!("Genie file {path} is not UTF-8: {e}")))?;

    // The FORMAT is the canonical target's, not the requested name's: an
    // in-tree symlink `flow.yml -> notes.md` holds markdown, and parsing it
    // as a workflow would produce a genie the runner cannot run (#149). The
    // requested path still names the genie.
    let ext = requested
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    let parsed = match ext.as_deref() {
        Some("md") => parse_genie(&content, path),
        Some("yml") | Some("yaml") => parse_workflow_genie(&content, path),
        // An ALLOW-list, not a markdown default (#345). Anything else in the
        // genies directory — a `.txt`, a `.json`, a file with no extension —
        // was parsed as markdown and served as a genie, while the scanner that
        // builds the picker lists only these three. The read and the listing
        // now agree on what a genie is.
        _ => Err(format!(
            "Genie file {path} is not a genie: expected a .md, .yml or .yaml file"
        )),
    };
    parsed.map_err(CommandError::invalid_input)
}

/// Build a `GenieContent` for a YAML workflow genie. Top-level `description`
/// (or, failing that, `name`) becomes the picker description; the filename is
/// the canonical display name; the body is the full YAML so the runner can
/// submit it.
fn parse_workflow_genie(content: &str, path: &str) -> Result<GenieContent, String> {
    let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(content)
        .map_err(|e| format!("Failed to parse YAML genie {}: {}", path, e))?;
    // Structure, not just syntax (#346). A scalar or a sequence is valid YAML
    // and is not a workflow: `RawWorkflow` requires a `steps` list, so such a
    // file could only ever appear in the picker and then fail the moment it
    // was run. Refused here, where the reason can be stated, rather than
    // offered as a row that cannot work.
    let map = value.as_mapping().filter(|m| {
        m.get(serde_yaml_ng::Value::String("steps".into()))
            .is_some_and(serde_yaml_ng::Value::is_sequence)
    });
    if map.is_none() {
        return Err(format!(
            "YAML genie {path} is not a workflow: expected a top-level mapping with a `steps:` list"
        ));
    }
    // The `name` from the YAML is shown as the secondary description if no
    // `description:` is present, so workflow authors who use `name:` for the
    // human-readable label still get something in the picker. Both are read
    // TRIMMED (#151): a whitespace-only description used to win over the
    // name and render a blank picker line.
    let description = yaml_str(map, "description")
        .or_else(|| yaml_str(map, "name"))
        .unwrap_or_default()
        .to_string();
    let name = Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    Ok(GenieContent {
        metadata: workflow_metadata(name, description),
        template: content.to_string(),
    })
}

/// A top-level YAML string, trimmed; `None` when absent, not a string, or
/// blank — so a caller's `or_else` fallback fires for all three alike.
fn yaml_str<'m>(map: Option<&'m serde_yaml_ng::Mapping>, key: &str) -> Option<&'m str> {
    map?.get(serde_yaml_ng::Value::String(key.to_string()))?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// The picker metadata every workflow genie carries. Workflow genies declare
/// scope on their YAML steps, not at the file level — the picker treats them
/// as document-scoped by default so they can run regardless of editor
/// selection state — and reuse the v1 `version` marker so the frontend
/// dispatcher can branch on it.
fn workflow_metadata(name: String, description: String) -> GenieMetadata {
    GenieMetadata {
        name,
        description,
        scope: "document".to_string(),
        category: None,
        model: None,
        action: None,
        context: None,
        approval: None,
        version: Some("workflow".to_string()),
        input: Some(GenieIoSpec {
            io_type: "workflow".to_string(),
            accept: None,
            description: None,
            schema: None,
        }),
        output: None,
        tags: None,
    }
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;

//! Genie type definitions.
//!
//! These types cross the Tauri IPC boundary to the frontend genie picker
//! (`geniesStore.ts` + `useGenieInvocation.ts`). Field-level docs are the
//! wire contract for both sides.

use serde::Serialize;

/// A discovered genie file with name, path, source, and optional category.
///
/// Returned by `list_genies` and consumed by the frontend `geniesStore`.
/// `kind` distinguishes one-shot markdown genies (`"markdown"`) from YAML
/// workflow genies (`"workflow"`), which the picker dispatches differently:
/// markdown genies invoke `run_ai_prompt` directly, workflow genies run
/// through `run_workflow` (WI-7.1).
#[derive(Debug, Serialize, Clone)]
pub struct GenieEntry {
    /// Filename stem (e.g. `improve` for `improve.md`). Stable across reloads
    /// — this is what `recent` / `favorite` lists key on.
    pub name: String,
    /// Absolute filesystem path. `read_genie` validates that paths are within
    /// the global genies directory before reading (path-traversal guard).
    pub path: String,
    /// Currently always `"global"`. Reserved for future per-workspace genies;
    /// any non-`"global"` value should be treated as undefined behavior by
    /// existing consumers.
    pub source: String,
    /// Subdirectory the file lives in, relative to the genies root, slash-
    /// normalized (e.g. `"writing"`, `"writing/long-form"`). `None` for
    /// files at the root. Used for picker grouping.
    pub category: Option<String>,
    /// Discriminator that tells the frontend which invocation path to take.
    pub kind: GenieKind,
}

/// Whether a genie is a one-shot markdown prompt or a multi-step YAML workflow.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GenieKind {
    /// `.md` file — runs once via `run_ai_prompt` with the filled template.
    Markdown,
    /// `.yml` / `.yaml` file — runs through `run_workflow` (multiple steps,
    /// optional approval, structured outputs).
    Workflow,
}

/// Parsed genie file: metadata from frontmatter and prompt template body.
///
/// Returned by `read_genie`. Markdown genies populate `template` with the
/// post-frontmatter prompt body; workflow genies populate it with the full
/// raw YAML so the runner can submit it via `run_workflow`.
#[derive(Debug, Serialize)]
pub struct GenieContent {
    /// Parsed frontmatter fields. See `GenieMetadata`.
    pub metadata: GenieMetadata,
    /// Markdown-genie prompt template OR raw YAML body for workflow genies.
    /// The frontend dispatches based on `metadata.version` and the file
    /// extension recorded in `GenieEntry.kind`.
    pub template: String,
}

/// Genie metadata extracted from YAML frontmatter (name, scope, model, etc.).
///
/// Frontmatter parser lives in `parsing.rs`. Empty `Option<...>` fields are
/// suppressed during serialization so the IPC payload stays small for
/// minimally-decorated genies.
#[derive(Debug, Serialize, PartialEq)]
pub struct GenieMetadata {
    /// Display name. Always derived from the filename stem; the frontmatter
    /// `name:` field is intentionally ignored so renaming the file changes
    /// the display name.
    pub name: String,
    /// One-line description for the picker row. Defaults to empty string.
    pub description: String,
    /// Editor scope the genie operates on. Value space is
    /// `"selection"` (default), `"block"`, `"document"`. Picker uses this
    /// to extract the right text before invocation; for workflow genies it
    /// defaults to `"document"` since YAML genies don't depend on editor
    /// selection state.
    pub scope: String,
    /// Display category (overrides the path-derived category from `GenieEntry`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Preferred AI model. Used by the picker as the default; the workflow
    /// runner threads it through ADR-6 step-config resolution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Suggestion type: `"replace"` (default) or `"insert"` (append after source).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Number of surrounding blocks to include as context (0–2). Anything
    /// outside that range is dropped during parsing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<u8>,
    /// Approval default for workflow execution: `"ask"` or `"auto"`.
    /// Step-level `approval:` overrides this; resolution per ADR-6.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<String>,
    // === Genie Spec v1 fields (typed I/O for workflows) ===
    /// Spec version marker. Present only for v1+ genies. Workflow genies
    /// (loaded by `read_genie` from `.yml`/`.yaml`) populate this with
    /// `"workflow"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Typed input spec (v1 only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<GenieIoSpec>,
    /// Typed output spec (v1 only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<GenieIoSpec>,
    /// Tags for search and gallery (v1 only). Comma-separated strings in
    /// frontmatter normalize to `Vec<String>` here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// Input/output type spec for Genie v1.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct GenieIoSpec {
    /// Type tag (`"text"`, `"json"`, `"file"`, `"files"`, `"pipe"`,
    /// `"workflow"`). Determines validation in `genie_step::validate_input`
    /// and post-processing in `genie_step::process_output`.
    #[serde(rename = "type")]
    pub io_type: String,
    /// Optional MIME / extension hint for file-typed inputs (e.g. `.md`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept: Option<String>,
    /// Human-readable description used by the picker / forms when prompting
    /// for the input value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON schema for v1 output validation (output spec only).
    /// Crossed Tauri IPC as `serde_json::Value` so the frontend gets a
    /// stable JSON shape rather than YAML-tagged data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_json::Value>,
}

/// Entry returned by menu scanning — title derived from filename.
///
/// Used by the native menu builder (`scan_genies_with_titles`); a parallel
/// type to `GenieEntry` because menu construction has different sort and
/// grouping semantics than the picker store.
pub struct GenieMenuEntry {
    /// Display title (filename stem). Always uses the on-disk filename so
    /// renaming a genie file changes its menu label.
    pub title: String,
    /// Absolute filesystem path to the `.md` / `.yml` / `.yaml` file.
    pub path: String,
    /// Subdirectory relative to the genies root (e.g. `"writing"`),
    /// slash-normalized; `None` for files at the root. Used for menu
    /// submenus.
    pub category: Option<String>,
}

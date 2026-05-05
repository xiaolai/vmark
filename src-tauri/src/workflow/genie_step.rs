//! Genie step executor (WI-2.2).
//!
//! Resolves a `uses: genie/<name>` step end-to-end:
//!   1. Look up the markdown genie by name in the global genies directory.
//!   2. Validate v1 `input.type` requirements against the step's `with:` map.
//!   3. Fill the genie's prompt template per ADR-2 alias rules.
//!   4. Call the AI provider via `run_ai_prompt_collect` with cancellation.
//!   5. Validate / parse the response per v1 `output.type`.
//!
//! The runner calls `execute_genie(...)` with everything pre-resolved; this
//! module owns no state and does no I/O beyond the genie file read.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use super::step_config::StepConfig;
use super::template;
use crate::ai_provider::run_ai_prompt_collect;
use crate::genies::types::GenieMetadata;

/// Provider invocation parameters resolved by the runner before each step.
///
/// Held by value rather than by reference so the runner can move it across
/// `await` boundaries without lifetime gymnastics. Derives `Deserialize` so
/// the frontend can pass the active provider config through the
/// `run_workflow` Tauri command alongside the YAML body.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// Provider type identifier: `"claude"`, `"codex"`, `"gemini"` (CLI),
    /// `"anthropic"`, `"openai"`, `"google-ai"`, `"ollama-api"` (REST).
    /// Anything else lands in the dispatcher's `_` arm and produces an
    /// `Unknown provider` error through the sink.
    pub provider: String,
    /// REST API key. Required for `anthropic`, `openai`, `google-ai`;
    /// optional for `ollama-api`; ignored for CLI providers.
    #[serde(default)]
    pub api_key: Option<String>,
    /// REST API base URL. Defaults are baked into the dispatcher
    /// (`https://api.anthropic.com`, `https://api.openai.com`,
    /// `http://localhost:11434`). `google-ai` ignores this — the URL is
    /// fixed to the public Google API host.
    #[serde(default)]
    pub endpoint: Option<String>,
    /// Resolved absolute path to a CLI binary. Used by `cli::build_command`
    /// to honor Windows `.cmd` / `.bat` shim resolution and to bypass PATH
    /// hijack (the dispatcher trusts this path verbatim, having received it
    /// from the frontend's earlier `detect_ai_providers` round trip).
    #[serde(default)]
    pub cli_path: Option<String>,
}

/// Loaded genie content as the executor needs it (name, metadata, template).
///
/// The runner provides a closure for loading rather than calling
/// `crate::genies::commands::read_genie` directly, so unit tests can inject
/// fixtures without touching the filesystem.
pub struct LoadedGenie {
    /// Parsed frontmatter — `metadata.version` distinguishes v0 from v1
    /// genies; v1 metadata's `input` / `output` shapes drive
    /// `validate_input` and `process_output`.
    pub metadata: GenieMetadata,
    /// Raw prompt body with `{{placeholder}}` tokens. Filled per ADR-2 by
    /// `template::fill` before the provider call.
    pub template: String,
}

/// Errors `execute_genie` can return as step-level failures.
///
/// Variants map to the diagnostic messages the runner emits via
/// `workflow:step-update` events.
#[derive(Debug, Clone, PartialEq)]
pub enum GenieStepError {
    /// `uses:` did not start with `genie/`.
    NotGenieStep,
    /// Genie not found in the resolved directory.
    NotFound(String),
    /// V1 input.type validation failed.
    InvalidInput(String),
    /// Template fill failed (unbound placeholders).
    Template(String),
    /// Provider call failed (returned `Err` from `run_ai_prompt_collect`).
    Provider(String),
    /// V1 output.type validation failed (e.g. invalid JSON).
    InvalidOutput(String),
    /// V1 output.type is not yet supported (file/files/pipe).
    UnsupportedOutput(String),
}

impl std::fmt::Display for GenieStepError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GenieStepError::NotGenieStep => write!(f, "Not a genie step"),
            GenieStepError::NotFound(name) => write!(f, "Genie '{}' not found", name),
            GenieStepError::InvalidInput(msg) => write!(f, "{}", msg),
            GenieStepError::Template(msg) => write!(f, "{}", msg),
            GenieStepError::Provider(msg) => write!(f, "{}", msg),
            GenieStepError::InvalidOutput(msg) => write!(f, "{}", msg),
            GenieStepError::UnsupportedOutput(t) => {
                write!(f, "Output type '{}' not supported yet", t)
            }
        }
    }
}

impl std::error::Error for GenieStepError {}

impl From<GenieStepError> for String {
    fn from(e: GenieStepError) -> String {
        e.to_string()
    }
}

/// Extract the genie name from a `uses: genie/<name>` string.
pub fn parse_genie_name(uses: &str) -> Result<&str, GenieStepError> {
    uses.strip_prefix("genie/")
        .ok_or(GenieStepError::NotGenieStep)
}

/// Validate that a v1 genie's `input` requirements are satisfied by the step's
/// `with:` map. Returns Ok for v0 genies (no input metadata).
pub fn validate_input(
    metadata: &GenieMetadata,
    params: &HashMap<String, String>,
) -> Result<(), GenieStepError> {
    let Some(input) = &metadata.input else {
        return Ok(()); // v0 — no validation
    };

    match input.io_type.as_str() {
        "text" => {
            // Either with.input or with.content satisfies a text-input genie.
            // The template's {{content}} alias picks up either.
            if !params.contains_key("input") && !params.contains_key("content") {
                return Err(GenieStepError::InvalidInput(format!(
                    "Genie '{}' requires with.input (or with.content) for input.type: text",
                    metadata.name
                )));
            }
            Ok(())
        }
        "json" => {
            let raw = params.get("input").ok_or_else(|| {
                GenieStepError::InvalidInput(format!(
                    "Genie '{}' requires with.input for input.type: json",
                    metadata.name
                ))
            })?;
            serde_json::from_str::<serde_json::Value>(raw).map_err(|e| {
                GenieStepError::InvalidInput(format!(
                    "with.input is not valid JSON for genie '{}': {}",
                    metadata.name, e
                ))
            })?;
            Ok(())
        }
        // Other input types (file, files) are accepted but the executor relies
        // on the runner having already pre-loaded the contents into with.input.
        // Per the plan, file-input is deferred to a future phase.
        other => Err(GenieStepError::InvalidInput(format!(
            "Input type '{}' not supported yet for genie '{}'",
            other, metadata.name
        ))),
    }
}

/// Process the AI provider response per the genie's v1 `output.type`.
///
/// Returns a `StepOutputs` map: each top-level field becomes one entry. The
/// "text" field is always present and holds the raw response (so downstream
/// `${{ steps.X.outputs.text }}` references and the legacy `stepId.output`
/// alias keep working unchanged).
///
/// - V0 genies and v1 `text` output: `{"text": response}` only.
/// - V1 `json` output: validates JSON, populates each top-level object key
///   into the map alongside "text". Required schema keys are enforced if
///   `output.schema.required` is present.
/// - File / files / pipe output types: return `UnsupportedOutput`.
pub fn process_output(
    metadata: &GenieMetadata,
    response: String,
) -> Result<HashMap<String, String>, GenieStepError> {
    let mut out = HashMap::new();

    let Some(output) = &metadata.output else {
        // v0
        out.insert("text".to_string(), response);
        return Ok(out);
    };

    match output.io_type.as_str() {
        "text" => {
            out.insert("text".to_string(), response);
            Ok(out)
        }
        "json" => {
            let parsed: serde_json::Value =
                serde_json::from_str(response.trim()).map_err(|e| {
                    GenieStepError::InvalidOutput(format!(
                        "Output not valid JSON for genie '{}': {}",
                        metadata.name, e
                    ))
                })?;

            // Validate required schema keys if present.
            if let Some(schema) = &output.schema {
                if let Some(required) = schema
                    .as_object()
                    .and_then(|m| m.get("required"))
                    .and_then(|r| r.as_array())
                {
                    if let Some(obj) = parsed.as_object() {
                        for key in required {
                            if let Some(name) = key.as_str() {
                                if !obj.contains_key(name) {
                                    return Err(GenieStepError::InvalidOutput(format!(
                                        "Output missing required field '{}' for genie '{}'",
                                        name, metadata.name
                                    )));
                                }
                            }
                        }
                    }
                }
            }

            // Populate each top-level field. Stringify values so the downstream
            // expression resolver (which works on String values) can consume
            // them. Authors who need the raw structure should reference "text"
            // and parse it themselves.
            if let Some(obj) = parsed.as_object() {
                for (k, v) in obj {
                    let value_str = match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    out.insert(k.clone(), value_str);
                }
            }
            out.insert("text".to_string(), response);
            Ok(out)
        }
        other => Err(GenieStepError::UnsupportedOutput(other.to_string())),
    }
}

/// Resolve the genies directory under the Tauri app data root.
pub fn resolve_genies_dir(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("genies")
}

/// Locate a genie file by name under `genies_dir`.
///
/// Walks the directory tree (matching `scan_genies_dir`'s behavior) and
/// returns the first `.md` file whose stem matches `name`. Returns
/// `GenieStepError::NotFound` if no match.
pub fn find_genie_file(genies_dir: &Path, name: &str) -> Result<std::path::PathBuf, GenieStepError> {
    fn walk(dir: &Path, name: &str) -> Option<std::path::PathBuf> {
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let ft = entry.file_type().ok()?;
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            if ft.is_dir() {
                if let Some(found) = walk(&path, name) {
                    return Some(found);
                }
            } else if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            {
                if path.file_stem().and_then(|s| s.to_str()) == Some(name) {
                    return Some(path);
                }
            }
        }
        None
    }
    walk(genies_dir, name).ok_or_else(|| GenieStepError::NotFound(name.to_string()))
}

/// Execute one `uses: genie/<name>` step end-to-end.
///
/// Steps:
///   1. Load the genie from `loaded` (caller resolved name → file → parsed).
///   2. Validate v1 input requirements.
///   3. Fill the template against `with_map`.
///   4. Call `run_ai_prompt_collect` with the resolved provider.
///   5. Process the response per v1 output type.
///
/// Returns the (post-processed) AI text on success.
pub async fn execute_genie(
    cancel: CancellationToken,
    loaded: &LoadedGenie,
    with_map: &HashMap<String, String>,
    step_config: &StepConfig,
    provider: &ProviderConfig,
) -> Result<HashMap<String, String>, GenieStepError> {
    // 1. Validate v1 input requirements.
    validate_input(&loaded.metadata, with_map)?;

    // 2. Fill the template per ADR-2 aliases.
    let prompt = template::fill(&loaded.template, with_map)
        .map_err(|e| GenieStepError::Template(e.to_string()))?;

    // 3. Call the AI provider with the resolved model (from step_config).
    // step_config.timeout_secs and approval are honored at the runner layer,
    // not here; this function is the provider-call atom only.
    let response = run_ai_prompt_collect(
        cancel,
        &provider.provider,
        &prompt,
        step_config.model.as_deref(),
        provider.api_key.as_deref(),
        provider.endpoint.as_deref(),
        provider.cli_path.as_deref(),
        step_config.max_tokens,
    )
    .await
    .map_err(GenieStepError::Provider)?;

    // 4. Process the response per v1 output type.
    process_output(&loaded.metadata, response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genies::types::GenieIoSpec;

    fn meta_v0() -> GenieMetadata {
        GenieMetadata {
            name: "improve".to_string(),
            description: String::new(),
            scope: "selection".to_string(),
            category: None,
            model: None,
            action: None,
            context: None,
            approval: None,
            version: None,
            input: None,
            output: None,
            tags: None,
        }
    }

    fn meta_v1(input_type: &str, output_type: &str) -> GenieMetadata {
        let mut m = meta_v0();
        m.version = Some("v1".to_string());
        m.input = Some(GenieIoSpec {
            io_type: input_type.to_string(),
            accept: None,
            description: None,
            schema: None,
        });
        m.output = Some(GenieIoSpec {
            io_type: output_type.to_string(),
            accept: None,
            description: None,
            schema: None,
        });
        m
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    // === parse_genie_name ===

    #[test]
    fn parse_genie_name_strips_prefix() {
        assert_eq!(parse_genie_name("genie/improve").unwrap(), "improve");
    }

    #[test]
    fn parse_genie_name_rejects_non_genie() {
        assert_eq!(
            parse_genie_name("action/read-file"),
            Err(GenieStepError::NotGenieStep)
        );
    }

    // === validate_input ===

    #[test]
    fn validate_v0_accepts_anything() {
        let r = validate_input(&meta_v0(), &HashMap::new());
        assert!(r.is_ok());
    }

    #[test]
    fn validate_v1_text_requires_input_or_content() {
        let m = meta_v1("text", "text");
        // Neither key present
        assert!(matches!(
            validate_input(&m, &HashMap::new()),
            Err(GenieStepError::InvalidInput(_))
        ));
        // with.input present
        assert!(validate_input(&m, &map(&[("input", "x")])).is_ok());
        // with.content present
        assert!(validate_input(&m, &map(&[("content", "x")])).is_ok());
    }

    #[test]
    fn validate_v1_json_requires_valid_json_in_input() {
        let m = meta_v1("json", "text");
        // Missing input
        assert!(matches!(
            validate_input(&m, &HashMap::new()),
            Err(GenieStepError::InvalidInput(_))
        ));
        // Invalid JSON
        assert!(matches!(
            validate_input(&m, &map(&[("input", "not json {")])),
            Err(GenieStepError::InvalidInput(_))
        ));
        // Valid JSON
        assert!(validate_input(&m, &map(&[("input", r#"{"k":"v"}"#)])).is_ok());
    }

    #[test]
    fn validate_v1_unsupported_input_type_errors() {
        let m = meta_v1("file", "text");
        let r = validate_input(&m, &map(&[("input", "x")]));
        assert!(matches!(r, Err(GenieStepError::InvalidInput(_))));
    }

    // === process_output ===

    #[test]
    fn process_v0_passes_through() {
        let r = process_output(&meta_v0(), "raw response".to_string()).unwrap();
        assert_eq!(r.get("text").map(String::as_str), Some("raw response"));
    }

    #[test]
    fn process_v1_text_passes_through() {
        let m = meta_v1("text", "text");
        let r = process_output(&m, "raw".to_string()).unwrap();
        assert_eq!(r.get("text").map(String::as_str), Some("raw"));
    }

    #[test]
    fn process_v1_json_validates_shape() {
        let m = meta_v1("text", "json");
        // Valid JSON: top-level fields populated alongside "text".
        let r = process_output(&m, r#"{"k": 1}"#.to_string()).unwrap();
        assert!(r.contains_key("text"));
        assert_eq!(r.get("k").map(String::as_str), Some("1"));
        // Invalid JSON
        assert!(matches!(
            process_output(&m, "not json {".to_string()),
            Err(GenieStepError::InvalidOutput(_))
        ));
    }

    #[test]
    fn process_v1_json_string_field_unquoted() {
        // String top-level fields lose their quotes so downstream `${{ steps.X.outputs.foo }}`
        // gets the value, not the JSON-encoded value.
        let m = meta_v1("text", "json");
        let r = process_output(&m, r#"{"title": "Hello", "summary": "World"}"#.to_string()).unwrap();
        assert_eq!(r.get("title").map(String::as_str), Some("Hello"));
        assert_eq!(r.get("summary").map(String::as_str), Some("World"));
    }

    #[test]
    fn process_v1_json_required_schema_keys_enforced() {
        let mut m = meta_v1("text", "json");
        if let Some(out) = m.output.as_mut() {
            out.schema = Some(serde_json::json!({
                "required": ["title", "summary"],
            }));
        }
        // Missing required field
        let r = process_output(&m, r#"{"title": "ok"}"#.to_string());
        assert!(matches!(
            r,
            Err(GenieStepError::InvalidOutput(ref msg)) if msg.contains("summary")
        ));
        // All required present
        let r = process_output(
            &m,
            r#"{"title": "ok", "summary": "fine"}"#.to_string(),
        )
        .unwrap();
        assert_eq!(r.get("summary").map(String::as_str), Some("fine"));
    }

    #[test]
    fn process_v1_file_output_unsupported() {
        let m = meta_v1("text", "file");
        let r = process_output(&m, "anything".to_string());
        assert!(matches!(
            r,
            Err(GenieStepError::UnsupportedOutput(ref s)) if s == "file"
        ));
    }

    #[test]
    fn process_v1_pipe_output_unsupported() {
        let m = meta_v1("text", "pipe");
        let r = process_output(&m, "anything".to_string());
        assert!(matches!(r, Err(GenieStepError::UnsupportedOutput(_))));
    }

    // === resolve_genies_dir / find_genie_file ===

    #[test]
    fn resolve_genies_dir_appends_genies() {
        let r = resolve_genies_dir(Path::new("/data"));
        assert_eq!(r, Path::new("/data/genies"));
    }

    #[test]
    fn find_genie_file_locates_md_in_root() {
        use std::io::Write;
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("improve.md");
        std::fs::File::create(&f).unwrap().write_all(b"---\n---\nbody").unwrap();
        assert_eq!(find_genie_file(tmp.path(), "improve").unwrap(), f);
    }

    #[test]
    fn find_genie_file_locates_md_in_subdir() {
        use std::io::Write;
        let tmp = tempfile::tempdir().unwrap();
        let sub = tmp.path().join("writing");
        std::fs::create_dir_all(&sub).unwrap();
        let f = sub.join("improve.md");
        std::fs::File::create(&f).unwrap().write_all(b"---\n---\nbody").unwrap();
        assert_eq!(find_genie_file(tmp.path(), "improve").unwrap(), f);
    }

    #[test]
    fn find_genie_file_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let r = find_genie_file(tmp.path(), "missing");
        assert!(matches!(r, Err(GenieStepError::NotFound(_))));
    }

    // === execute_genie (template + provider) ===

    fn step_config_with_model(model: Option<&str>) -> StepConfig {
        StepConfig {
            model: model.map(String::from),
            approval: "auto".to_string(),
            timeout_secs: 300,
            max_tokens: None,
        }
    }

    fn provider_echo() -> ProviderConfig {
        // Force the dispatcher's "claude" branch but redirect cli_path to
        // /bin/echo so the test doesn't depend on a real CLI tool.
        ProviderConfig {
            provider: "claude".to_string(),
            api_key: None,
            endpoint: None,
            cli_path: Some("/bin/echo".to_string()),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn execute_v0_with_input_alias_via_content() {
        // V0 genie template uses {{content}}; with.input supplies the value
        // through the alias chain (ADR-2).
        let loaded = LoadedGenie {
            metadata: meta_v0(),
            template: "Edit this: {{content}}".to_string(),
        };
        let cancel = CancellationToken::new();
        let res = execute_genie(
            cancel,
            &loaded,
            &map(&[("input", "hello-text")]),
            &step_config_with_model(None),
            &provider_echo(),
        )
        .await;
        assert!(res.is_ok(), "{:?}", res);
        // /bin/echo echoes the (filled) prompt back; the genie output should
        // contain the text we passed via with.input.
        let map = res.unwrap();
        let text = map.get("text").cloned().unwrap_or_default();
        assert!(text.contains("hello-text"), "expected echoed text in {}", text);
    }

    #[tokio::test]
    async fn execute_unbound_template_fails_before_provider_call() {
        // Genie expects {{content}}, with.input absent, with.content absent.
        // Template fill is fatal — provider should never be invoked.
        let loaded = LoadedGenie {
            metadata: meta_v0(),
            template: "Edit: {{content}}".to_string(),
        };
        let cancel = CancellationToken::new();
        let res = execute_genie(
            cancel,
            &loaded,
            &HashMap::new(),
            &step_config_with_model(None),
            &provider_echo(),
        )
        .await;
        assert!(matches!(res, Err(GenieStepError::Template(_))));
    }

    #[tokio::test]
    async fn execute_v1_invalid_input_fails_before_provider_call() {
        let loaded = LoadedGenie {
            metadata: meta_v1("text", "text"),
            template: "do thing".to_string(),
        };
        let cancel = CancellationToken::new();
        let res = execute_genie(
            cancel,
            &loaded,
            &HashMap::new(), // missing required input
            &step_config_with_model(None),
            &provider_echo(),
        )
        .await;
        assert!(matches!(res, Err(GenieStepError::InvalidInput(_))));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn execute_unsupported_output_type_errors_after_call() {
        // v1 output.type: file isn't supported. The provider runs (we get text)
        // but post-processing rejects.
        // Unix-only: provider_echo() uses /bin/echo which isn't a Windows
        // binary. The unsupported-output validation logic itself is platform-
        // independent (process_output is exercised in non-async tests above).
        let loaded = LoadedGenie {
            metadata: meta_v1("text", "file"),
            template: "produce {{input}}".to_string(),
        };
        let cancel = CancellationToken::new();
        let res = execute_genie(
            cancel,
            &loaded,
            &map(&[("input", "x")]),
            &step_config_with_model(None),
            &provider_echo(),
        )
        .await;
        assert!(matches!(
            res,
            Err(GenieStepError::UnsupportedOutput(ref s)) if s == "file"
        ));
    }
}

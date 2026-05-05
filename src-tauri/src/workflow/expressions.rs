//! Expression parser for workflow parameter values (WI-2.3 / ADR-3).
//!
//! Resolves these forms inside `with:` parameter values:
//!
//! | Syntax | Resolves to |
//! |---|---|
//! | `${{ steps.ID.outputs.FIELD }}` | `outputs[ID][FIELD]` |
//! | `${{ steps.ID.output }}` | `outputs[ID]["text"]` (sugar) |
//! | `${{ env.NAME }}` | `env[NAME]` |
//! | `${VAR}` (legacy) | `env[VAR]` (preserved for backward compat) |
//! | `stepId.output` (full-string match, legacy) | `outputs[stepId]["text"]` |
//!
//! Order of operations:
//!   1. Strip-and-resolve all `${{ ... }}` occurrences. Unknown refs return
//!      `Err`; this is fatal at the runner level.
//!   2. Resolve `${VAR}` env-var refs on the remaining text via regex.
//!   3. If the entire (post-2) value matches `^\w+\.output$` and `outputs`
//!      contains that step, substitute `outputs[id]["text"]`.
//!
//! Steps 1 and 2 don't overlap: the `\w+` env regex doesn't match the inner
//! contents of `${{ ... }}` (which contain `.` and spaces). Step 3 only
//! triggers if the entire value looks like a bare alias, so it can't false-
//! match content that already had legitimate `.output` suffix in prose.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

/// Outputs map shape used by the runner (WI-2.3): step id → (field name → value).
pub type WorkflowOutputs = HashMap<String, HashMap<String, String>>;

static ENV_VAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{(\w+)\}").expect("invalid env var regex"));

/// Match `${{ <body> }}` with whitespace-tolerant body capture.
static EXPR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{\{\s*([^}]+?)\s*\}\}").expect("invalid expr regex"));

/// Match a bare `stepId.output` whole-string alias.
static BARE_ALIAS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z_][\w-]*)\.output$").expect("invalid bare alias regex"));

/// Errors that can arise while resolving an expression.
#[derive(Debug, Clone, PartialEq)]
pub enum ExprError {
    /// `${{ steps.X.outputs.Y }}` referenced a step that doesn't exist.
    UnknownStep(String),
    /// `${{ steps.X.outputs.Y }}` referenced a missing output field.
    MissingField { step: String, field: String },
    /// `${{ env.X }}` referenced a missing environment variable.
    UnknownEnv(String),
    /// `${{ <body> }}` had a body the parser couldn't recognize.
    Unsupported(String),
}

impl std::fmt::Display for ExprError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExprError::UnknownStep(s) => write!(f, "Reference to unknown step '{}'", s),
            ExprError::MissingField { step, field } => write!(
                f,
                "Step '{}' output '{}' not available",
                step, field
            ),
            ExprError::UnknownEnv(name) => write!(f, "Reference to unknown env var '{}'", name),
            ExprError::Unsupported(body) => {
                write!(f, "Unsupported expression: ${{{{ {} }}}}", body)
            }
        }
    }
}

/// Resolve every supported reference form in `value`.
pub fn resolve(
    value: &str,
    outputs: &WorkflowOutputs,
    env: &HashMap<String, String>,
) -> Result<String, ExprError> {
    // Step 1: ${{ ... }} expressions
    let mut after_expr = String::with_capacity(value.len());
    let mut last_end = 0;
    for caps in EXPR_RE.captures_iter(value) {
        let whole = caps.get(0).expect("regex match always has whole");
        let body = caps.get(1).expect("regex requires capture 1").as_str();
        after_expr.push_str(&value[last_end..whole.start()]);
        after_expr.push_str(&resolve_expr_body(body, outputs, env)?);
        last_end = whole.end();
    }
    after_expr.push_str(&value[last_end..]);

    // Step 2: ${VAR} env refs (legacy). Strict: unknown name is fatal so
    // author mistakes don't silently produce wrong prompts/paths. Same
    // behavior as the modern ${{ env.X }} form.
    let mut env_err: Option<String> = None;
    let after_env = ENV_VAR_RE
        .replace_all(&after_expr, |caps: &regex::Captures| {
            let name = &caps[1];
            match env.get(name) {
                Some(v) => v.clone(),
                None => {
                    if env_err.is_none() {
                        env_err = Some(name.to_string());
                    }
                    String::new()
                }
            }
        })
        .to_string();
    if let Some(name) = env_err {
        return Err(ExprError::UnknownEnv(name));
    }

    // Step 3: bare stepId.output alias (whole-string)
    if let Some(alias_caps) = BARE_ALIAS_RE.captures(after_env.trim()) {
        let id = alias_caps.get(1).unwrap().as_str();
        if let Some(step_outputs) = outputs.get(id) {
            if let Some(text) = step_outputs.get("text") {
                return Ok(text.clone());
            }
            return Err(ExprError::MissingField {
                step: id.to_string(),
                field: "text".to_string(),
            });
        }
        return Err(ExprError::UnknownStep(id.to_string()));
    }

    Ok(after_env)
}

fn resolve_expr_body(
    body: &str,
    outputs: &WorkflowOutputs,
    env: &HashMap<String, String>,
) -> Result<String, ExprError> {
    let body = body.trim();

    // env.NAME
    if let Some(name) = body.strip_prefix("env.") {
        return env
            .get(name)
            .cloned()
            .ok_or_else(|| ExprError::UnknownEnv(name.to_string()));
    }

    // steps.ID.outputs.FIELD  or  steps.ID.output (sugar)
    if let Some(rest) = body.strip_prefix("steps.") {
        let parts: Vec<&str> = rest.split('.').collect();
        match parts.as_slice() {
            // steps.ID.output
            [id, "output"] => {
                let map = outputs
                    .get(*id)
                    .ok_or_else(|| ExprError::UnknownStep((*id).to_string()))?;
                return map.get("text").cloned().ok_or_else(|| ExprError::MissingField {
                    step: (*id).to_string(),
                    field: "text".to_string(),
                });
            }
            // steps.ID.outputs.FIELD
            [id, "outputs", field] => {
                let map = outputs
                    .get(*id)
                    .ok_or_else(|| ExprError::UnknownStep((*id).to_string()))?;
                return map
                    .get(*field)
                    .cloned()
                    .ok_or_else(|| ExprError::MissingField {
                        step: (*id).to_string(),
                        field: (*field).to_string(),
                    });
            }
            _ => {}
        }
    }

    Err(ExprError::Unsupported(body.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outputs(pairs: &[(&str, &[(&str, &str)])]) -> WorkflowOutputs {
        pairs
            .iter()
            .map(|(id, fields)| {
                (
                    (*id).to_string(),
                    fields
                        .iter()
                        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                        .collect(),
                )
            })
            .collect()
    }

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    // === ${{ steps.X.outputs.Y }} ===

    #[test]
    fn resolves_steps_outputs_field() {
        let o = outputs(&[("first", &[("text", "ok"), ("score", "9")])]);
        let r = resolve("${{ steps.first.outputs.score }}", &o, &HashMap::new()).unwrap();
        assert_eq!(r, "9");
    }

    #[test]
    fn unknown_step_errors() {
        let r = resolve("${{ steps.ghost.outputs.text }}", &HashMap::new(), &HashMap::new());
        assert!(matches!(r, Err(ExprError::UnknownStep(_))));
    }

    #[test]
    fn missing_field_errors() {
        let o = outputs(&[("first", &[("text", "ok")])]);
        let r = resolve("${{ steps.first.outputs.score }}", &o, &HashMap::new());
        assert!(matches!(r, Err(ExprError::MissingField { ref step, ref field }) if step == "first" && field == "score"));
    }

    // === ${{ steps.X.output }} sugar ===

    #[test]
    fn resolves_steps_output_sugar() {
        let o = outputs(&[("first", &[("text", "default")])]);
        let r = resolve("${{ steps.first.output }}", &o, &HashMap::new()).unwrap();
        assert_eq!(r, "default");
    }

    // === ${{ env.NAME }} ===

    #[test]
    fn resolves_env() {
        let r = resolve("${{ env.HOME }}", &HashMap::new(), &env(&[("HOME", "/home/x")])).unwrap();
        assert_eq!(r, "/home/x");
    }

    #[test]
    fn unknown_env_errors() {
        let r = resolve("${{ env.MISSING }}", &HashMap::new(), &HashMap::new());
        assert!(matches!(r, Err(ExprError::UnknownEnv(_))));
    }

    // === legacy ${VAR} ===

    #[test]
    fn legacy_env_var_still_works() {
        let r = resolve("path/${HOME}/file", &HashMap::new(), &env(&[("HOME", "/u")])).unwrap();
        assert_eq!(r, "path//u/file");
    }

    #[test]
    fn legacy_env_alongside_expr() {
        // Both forms in the same value.
        let r = resolve(
            "${HOME}/${{ env.NAME }}",
            &HashMap::new(),
            &env(&[("HOME", "/u"), ("NAME", "alice")]),
        )
        .unwrap();
        assert_eq!(r, "/u/alice");
    }

    // === bare stepId.output (legacy) ===

    #[test]
    fn bare_alias_resolves_to_text() {
        let o = outputs(&[("read", &[("text", "file body")])]);
        let r = resolve("read.output", &o, &HashMap::new()).unwrap();
        assert_eq!(r, "file body");
    }

    #[test]
    fn bare_alias_unknown_step_errors() {
        let r = resolve("ghost.output", &HashMap::new(), &HashMap::new());
        assert!(matches!(r, Err(ExprError::UnknownStep(_))));
    }

    #[test]
    fn bare_alias_only_matches_whole_value() {
        // `prefix read.output` — not a whole-string alias; passes through.
        let o = outputs(&[("read", &[("text", "x")])]);
        let r = resolve("prefix read.output", &o, &HashMap::new()).unwrap();
        assert_eq!(r, "prefix read.output"); // not substituted
    }

    // === interleaved literal + expr ===

    #[test]
    fn literal_text_passes_through() {
        let r = resolve("Hello, world!", &HashMap::new(), &HashMap::new()).unwrap();
        assert_eq!(r, "Hello, world!");
    }

    #[test]
    fn multiple_expressions_in_one_value() {
        let o = outputs(&[
            ("a", &[("text", "alpha")]),
            ("b", &[("text", "beta")]),
        ]);
        let r = resolve(
            "${{ steps.a.output }} + ${{ steps.b.output }}",
            &o,
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(r, "alpha + beta");
    }

    #[test]
    fn unsupported_expression_errors() {
        let r = resolve("${{ secrets.API_KEY }}", &HashMap::new(), &HashMap::new());
        assert!(matches!(r, Err(ExprError::Unsupported(_))));
    }

    // === regression: $\{NAME} inside ${{ }} doesn't false-match ===

    #[test]
    fn env_regex_does_not_collide_with_expr_braces() {
        let o = outputs(&[("a", &[("text", "ok")])]);
        // The body of ${{ }} contains `.` which `\w+` won't match — verify
        // the env regex doesn't try to substitute pieces of the expression.
        let r = resolve(
            "${{ steps.a.output }} ${LEGIT}",
            &o,
            &env(&[("LEGIT", "yes")]),
        )
        .unwrap();
        assert_eq!(r, "ok yes");
    }
}

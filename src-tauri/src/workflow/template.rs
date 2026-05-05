//! Genie template renderer (ADR-2).
//!
//! Fills `{{placeholder}}` tokens in a genie template body with values from a
//! step's `with:` map. Substitution rules (in this precedence):
//!
//!   1. `{{input}}` → `with["input"]`.
//!   2. `{{content}}` → `with["content"]` if present, else `with["input"]`.
//!      **Fatal** if neither is present.
//!   3. `{{context}}` → `with["context"]` if present, else the empty string.
//!      **Never fatal.**
//!   4. `{{key}}` → `with[key]` for any other key.
//!   5. Unbound placeholders are a **fatal step error** — the runner returns
//!      `TemplateError::Unbound(names)` listing every unresolved placeholder
//!      and skips the provider call.
//!
//! Substitution is **single pass**: nested `{{` inside replaced content is
//! NOT re-processed. This guards against accidental template-injection from
//! AI-generated input.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

/// Match `{{ key }}` placeholders. The capture group is the key name (Unicode
/// word chars). Whitespace inside the braces is allowed and ignored.
static PLACEHOLDER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*(\w+)\s*\}\}").expect("invalid placeholder regex"));

/// Errors that can arise while filling a template.
#[derive(Debug, Clone, PartialEq)]
pub enum TemplateError {
    /// One or more placeholders could not be resolved. The vec lists every
    /// unresolved placeholder name in left-to-right order with duplicates
    /// preserved (so authors can spot a typo that appears twice).
    Unbound(Vec<String>),
}

impl std::fmt::Display for TemplateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TemplateError::Unbound(names) => {
                let formatted = names
                    .iter()
                    .map(|n| format!("{{{{{}}}}}", n))
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(f, "Unbound placeholders: {}", formatted)
            }
        }
    }
}

impl std::error::Error for TemplateError {}

/// Fill a template with a step's `with:` parameters per ADR-2 rules.
///
/// Returns `Err(TemplateError::Unbound)` if any placeholder remains unresolved
/// after applying aliases. Bound placeholders are substituted in-place.
pub fn fill(template: &str, with_map: &HashMap<String, String>) -> Result<String, TemplateError> {
    let mut unbound: Vec<String> = Vec::new();
    let mut output = String::with_capacity(template.len());
    let mut last_end = 0;

    for caps in PLACEHOLDER_RE.captures_iter(template) {
        let whole_match = caps.get(0).expect("regex match always has whole match");
        let key = caps
            .get(1)
            .expect("placeholder regex requires capture group")
            .as_str();

        // Append text between previous match and this one.
        output.push_str(&template[last_end..whole_match.start()]);

        match resolve_placeholder(key, with_map) {
            Resolution::Bound(value) => output.push_str(&value),
            Resolution::Unbound => {
                // Preserve the literal placeholder for diagnostic clarity, but
                // the function will return Err once we finish scanning.
                unbound.push(key.to_string());
                output.push_str(whole_match.as_str());
            }
        }

        last_end = whole_match.end();
    }

    // Tail after the last match.
    output.push_str(&template[last_end..]);

    if unbound.is_empty() {
        Ok(output)
    } else {
        Err(TemplateError::Unbound(unbound))
    }
}

enum Resolution {
    Bound(String),
    Unbound,
}

/// Resolve a single placeholder per the alias rules in ADR-2.
fn resolve_placeholder(key: &str, with_map: &HashMap<String, String>) -> Resolution {
    match key {
        // Rule 3: `{{context}}` is never fatal. If `with.context` missing,
        // resolves to the empty string.
        "context" => Resolution::Bound(
            with_map
                .get("context")
                .cloned()
                .unwrap_or_default(),
        ),
        // Rule 2: `{{content}}` aliases content → input. Fatal if neither.
        "content" => match with_map.get("content").or_else(|| with_map.get("input")) {
            Some(v) => Resolution::Bound(v.clone()),
            None => Resolution::Unbound,
        },
        // Rules 1 & 4: bare key lookup — `{{input}}` uses with["input"], any
        // other `{{key}}` uses with[key]. Unbound if missing.
        _ => match with_map.get(key) {
            Some(v) => Resolution::Bound(v.clone()),
            None => Resolution::Unbound,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn bare_key_substitutes() {
        let r = fill("Hello, {{name}}!", &map(&[("name", "world")])).unwrap();
        assert_eq!(r, "Hello, world!");
    }

    #[test]
    fn whitespace_inside_braces_tolerated() {
        let r = fill("Hello, {{ name }}!", &map(&[("name", "world")])).unwrap();
        assert_eq!(r, "Hello, world!");
    }

    #[test]
    fn input_alias_resolves_to_with_input() {
        let r = fill("Translate: {{input}}", &map(&[("input", "hello")])).unwrap();
        assert_eq!(r, "Translate: hello");
    }

    #[test]
    fn content_alias_resolves_to_with_content_when_present() {
        let r = fill(
            "Edit: {{content}}",
            &map(&[("content", "from-content"), ("input", "from-input")]),
        )
        .unwrap();
        assert_eq!(r, "Edit: from-content");
    }

    #[test]
    fn content_alias_falls_back_to_with_input() {
        let r = fill("Edit: {{content}}", &map(&[("input", "fallback")])).unwrap();
        assert_eq!(r, "Edit: fallback");
    }

    #[test]
    fn content_alias_fatal_when_neither_present() {
        let r = fill("Edit: {{content}}", &map(&[("other", "x")]));
        assert!(matches!(r, Err(TemplateError::Unbound(ref v)) if v == &vec!["content".to_string()]));
    }

    #[test]
    fn context_alias_resolves_to_empty_when_absent() {
        let r = fill("Around: [{{context}}]", &HashMap::new()).unwrap();
        assert_eq!(r, "Around: []");
    }

    #[test]
    fn context_alias_uses_with_context_when_present() {
        let r = fill(
            "Around: [{{context}}]",
            &map(&[("context", "surrounding text")]),
        )
        .unwrap();
        assert_eq!(r, "Around: [surrounding text]");
    }

    #[test]
    fn unbound_placeholder_is_fatal() {
        let r = fill("Hello, {{name}}!", &HashMap::new());
        assert!(matches!(r, Err(TemplateError::Unbound(_))));
    }

    #[test]
    fn multiple_unbound_listed_in_order() {
        let r = fill("{{first}} and {{second}} and {{third}}", &HashMap::new());
        match r {
            Err(TemplateError::Unbound(names)) => {
                assert_eq!(names, vec!["first", "second", "third"]);
            }
            _ => panic!("expected Unbound error"),
        }
    }

    #[test]
    fn duplicate_unbound_appears_twice() {
        // Author's intent: catching the same typo twice should report it twice.
        let r = fill("{{typo}} and again {{typo}}", &HashMap::new());
        match r {
            Err(TemplateError::Unbound(names)) => {
                assert_eq!(names, vec!["typo", "typo"]);
            }
            _ => panic!("expected Unbound error"),
        }
    }

    #[test]
    fn one_unbound_one_bound_is_fatal() {
        let r = fill(
            "{{has}} and {{missing}}",
            &map(&[("has", "ok")]),
        );
        match r {
            Err(TemplateError::Unbound(names)) => {
                assert_eq!(names, vec!["missing"]);
            }
            _ => panic!("expected Unbound error"),
        }
    }

    #[test]
    fn no_placeholders_returns_template_verbatim() {
        let r = fill("plain text — no braces here", &HashMap::new()).unwrap();
        assert_eq!(r, "plain text — no braces here");
    }

    #[test]
    fn empty_template_resolves_to_empty() {
        let r = fill("", &HashMap::new()).unwrap();
        assert_eq!(r, "");
    }

    #[test]
    fn substitution_is_single_pass_no_recursion() {
        // If `{{a}}` resolves to text containing `{{b}}`, the inner placeholder
        // is NOT re-processed. This guards against template-injection from
        // AI-generated input that happens to contain `{{...}}` syntax.
        let r = fill(
            "{{a}}",
            &map(&[("a", "literal {{b}} stays literal"), ("b", "second")]),
        )
        .unwrap();
        assert_eq!(r, "literal {{b}} stays literal");
    }

    #[test]
    fn template_error_display_includes_names_with_braces() {
        let err = TemplateError::Unbound(vec!["foo".to_string(), "bar".to_string()]);
        let msg = err.to_string();
        assert!(msg.contains("{{foo}}"));
        assert!(msg.contains("{{bar}}"));
    }

    #[test]
    fn unicode_keys_substitute() {
        let r = fill("{{名前}}: hi", &map(&[("名前", "matsumoto")])).unwrap();
        assert_eq!(r, "matsumoto: hi");
    }

    #[test]
    fn unicode_values_substitute() {
        let r = fill("{{name}}", &map(&[("name", "学习 Python")])).unwrap();
        assert_eq!(r, "学习 Python");
    }
}

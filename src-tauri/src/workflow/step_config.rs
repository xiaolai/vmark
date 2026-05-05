//! Per-step configuration resolution per ADR-6.
//!
//! Resolves the effective `model`, `approval`, and `limits` for a workflow
//! step by walking a precedence chain:
//!
//! 1. The step itself (`step.model`, `step.approval`, `step.limits`)
//! 2. The genie metadata (only for `uses: genie/*` steps)
//! 3. The workflow's `defaults:` block
//! 4. A hard-coded fallback (300s timeout, "auto" approval, provider-default
//!    model)
//!
//! Pure data; no I/O. Easy to unit-test.

use super::types::{RawDefaults, RawLimits, RawStep};
use crate::genies::types::GenieMetadata;

/// Default step timeout when nothing along the precedence chain sets one.
pub const DEFAULT_STEP_TIMEOUT_SECS: u64 = 300;

/// Effective configuration for a single step after precedence resolution.
#[derive(Debug, Clone, PartialEq)]
pub struct StepConfig {
    /// Resolved model name. `None` means "let the provider pick its default."
    pub model: Option<String>,
    /// Resolved approval mode: "auto" or "ask".
    pub approval: String,
    /// Resolved step timeout in seconds.
    pub timeout_secs: u64,
    /// Resolved max-tokens (REST providers only). `None` means
    /// "provider default" (CLI providers always treat this as None per D8).
    pub max_tokens: Option<u64>,
}

/// Parse a duration string ("300s", "5m", "1h") into seconds.
/// Returns `None` for unparseable input. Plain integers are treated as seconds.
fn parse_timeout(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Pure integer → seconds.
    if let Ok(n) = trimmed.parse::<u64>() {
        return Some(n);
    }
    // Suffixed forms.
    let (numeric, unit) = trimmed.split_at(trimmed.len() - 1);
    let n: u64 = numeric.parse().ok()?;
    match unit {
        "s" => Some(n),
        "m" => Some(n.saturating_mul(60)),
        "h" => Some(n.saturating_mul(3600)),
        _ => None,
    }
}

/// Resolve step configuration per ADR-6.
///
/// `genie_meta` is `None` when the step is not a `genie/*` step or the genie
/// metadata isn't loaded yet.
pub fn resolve_step_config(
    step: &RawStep,
    genie_meta: Option<&GenieMetadata>,
    defaults: &RawDefaults,
) -> StepConfig {
    // model: step → genie → defaults → None
    let model = step
        .model
        .clone()
        .or_else(|| genie_meta.and_then(|g| g.model.clone()))
        .or_else(|| defaults.model.clone());

    // approval: step → genie → defaults → "auto"
    let approval = step
        .approval
        .clone()
        .or_else(|| genie_meta.and_then(|g| g.approval.clone()))
        .or_else(|| defaults.approval.clone())
        .unwrap_or_else(|| "auto".to_string());

    // timeout: step.limits.timeout → defaults.limits.timeout → DEFAULT
    let timeout_secs = step
        .limits
        .as_ref()
        .and_then(|l| l.timeout.as_deref())
        .and_then(parse_timeout)
        .or_else(|| {
            defaults
                .limits
                .as_ref()
                .and_then(|l| l.timeout.as_deref())
                .and_then(parse_timeout)
        })
        .unwrap_or(DEFAULT_STEP_TIMEOUT_SECS);

    // max_tokens: step.limits.max_tokens → defaults.limits.max_tokens → None
    let max_tokens = step
        .limits
        .as_ref()
        .and_then(|l| l.max_tokens)
        .or_else(|| defaults.limits.as_ref().and_then(|l| l.max_tokens));

    StepConfig {
        model,
        approval,
        timeout_secs,
        max_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genies::types::GenieMetadata;
    use crate::workflow::types::{NeedsDef, RawStep};

    fn step(model: Option<&str>, approval: Option<&str>, limits: Option<RawLimits>) -> RawStep {
        RawStep {
            id: Some("s1".to_string()),
            uses: "genie/test".to_string(),
            with: Default::default(),
            needs: NeedsDef::None,
            condition: None,
            model: model.map(String::from),
            approval: approval.map(String::from),
            limits,
        }
    }

    fn genie_meta(model: Option<&str>, approval: Option<&str>) -> GenieMetadata {
        GenieMetadata {
            name: "test".to_string(),
            description: String::new(),
            scope: "selection".to_string(),
            category: None,
            model: model.map(String::from),
            action: None,
            context: None,
            approval: approval.map(String::from),
            version: None,
            input: None,
            output: None,
            tags: None,
        }
    }

    // === ADR-6 row 1: model precedence ===

    #[test]
    fn model_step_wins_over_genie_and_defaults() {
        let step = step(Some("step-model"), None, None);
        let genie = genie_meta(Some("genie-model"), None);
        let defaults = RawDefaults {
            model: Some("default-model".to_string()),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, Some(&genie), &defaults);
        assert_eq!(cfg.model.as_deref(), Some("step-model"));
    }

    #[test]
    fn model_genie_wins_when_step_unset() {
        let step = step(None, None, None);
        let genie = genie_meta(Some("genie-model"), None);
        let defaults = RawDefaults {
            model: Some("default-model".to_string()),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, Some(&genie), &defaults);
        assert_eq!(cfg.model.as_deref(), Some("genie-model"));
    }

    #[test]
    fn model_defaults_wins_when_step_and_genie_unset() {
        let step = step(None, None, None);
        let defaults = RawDefaults {
            model: Some("default-model".to_string()),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.model.as_deref(), Some("default-model"));
    }

    #[test]
    fn model_none_when_nothing_set() {
        let step = step(None, None, None);
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.model, None);
    }

    // === ADR-6 row 2: approval precedence ===

    #[test]
    fn approval_step_wins_over_genie_and_defaults() {
        let step = step(None, Some("ask"), None);
        let genie = genie_meta(None, Some("auto"));
        let defaults = RawDefaults {
            approval: Some("auto".to_string()),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, Some(&genie), &defaults);
        assert_eq!(cfg.approval, "ask");
    }

    #[test]
    fn approval_genie_wins_when_step_unset() {
        let step = step(None, None, None);
        let genie = genie_meta(None, Some("ask"));
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, Some(&genie), &defaults);
        assert_eq!(cfg.approval, "ask");
    }

    #[test]
    fn approval_defaults_wins_when_step_and_genie_unset() {
        let step = step(None, None, None);
        let defaults = RawDefaults {
            approval: Some("ask".to_string()),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.approval, "ask");
    }

    #[test]
    fn approval_falls_back_to_auto() {
        let step = step(None, None, None);
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.approval, "auto");
    }

    // === ADR-6 row 3: timeout precedence ===

    #[test]
    fn timeout_step_wins_over_defaults() {
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: Some("30s".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
        );
        let defaults = RawDefaults {
            limits: Some(RawLimits {
                timeout: Some("60s".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 30);
    }

    #[test]
    fn timeout_defaults_wins_when_step_unset() {
        let step = step(None, None, None);
        let defaults = RawDefaults {
            limits: Some(RawLimits {
                timeout: Some("60s".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 60);
    }

    #[test]
    fn timeout_falls_back_to_default() {
        let step = step(None, None, None);
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, DEFAULT_STEP_TIMEOUT_SECS);
    }

    #[test]
    fn timeout_parses_minute_suffix() {
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: Some("5m".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
        );
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 300);
    }

    #[test]
    fn timeout_parses_hour_suffix() {
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: Some("1h".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
        );
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 3600);
    }

    #[test]
    fn timeout_parses_bare_integer_as_seconds() {
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: Some("45".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
        );
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 45);
    }

    #[test]
    fn timeout_garbage_falls_through_chain() {
        // Garbage at the step layer falls through to defaults, not the hard fallback.
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: Some("nonsense".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
        );
        let defaults = RawDefaults {
            limits: Some(RawLimits {
                timeout: Some("90s".to_string()),
                max_tokens: None,
                max_cost: None,
            }),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.timeout_secs, 90);
    }

    // === ADR-6 row 4: max_tokens precedence ===

    #[test]
    fn max_tokens_step_wins_over_defaults() {
        let step = step(
            None,
            None,
            Some(RawLimits {
                timeout: None,
                max_tokens: Some(1000),
                max_cost: None,
            }),
        );
        let defaults = RawDefaults {
            limits: Some(RawLimits {
                timeout: None,
                max_tokens: Some(2000),
                max_cost: None,
            }),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.max_tokens, Some(1000));
    }

    #[test]
    fn max_tokens_defaults_wins_when_step_unset() {
        let step = step(None, None, None);
        let defaults = RawDefaults {
            limits: Some(RawLimits {
                timeout: None,
                max_tokens: Some(2000),
                max_cost: None,
            }),
            ..Default::default()
        };
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.max_tokens, Some(2000));
    }

    #[test]
    fn max_tokens_none_when_nothing_set() {
        let step = step(None, None, None);
        let defaults = RawDefaults::default();
        let cfg = resolve_step_config(&step, None, &defaults);
        assert_eq!(cfg.max_tokens, None);
    }
}

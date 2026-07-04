// RW-6 (L10) — workflow if: expression evaluation
// audit-fix — cap condition parser recursion depth
//
//! Boolean condition evaluator for workflow steps' `if:` field.
//!
//! Replaces the old literal-`false`/`0` check with a real expression
//! evaluator: a tokenizer + Pratt parser supporting GitHub-Actions-style
//! conditions. The whole condition may be wrapped in one `${{ ... }}`.
//!
//! Supported grammar:
//!
//! | Form | Meaning |
//! |---|---|
//! | `true` / `false` (case-insensitive) | boolean literal |
//! | `1` / `0` | truthy / falsy literal |
//! | `success()` | `!any_failed` |
//! | `failure()` | `any_failed` |
//! | `always()` | `true` |
//! | `'str'` / `"str"` | string literal operand |
//! | number | numeric operand |
//! | `${{ ... }}`, `steps.X.outputs.Y`, `env.NAME` | reference operands (via `expressions::resolve`) |
//! | `==`, `!=` | equality (numeric if both parse as f64, else string) |
//! | `>`, `<`, `>=`, `<=` | numeric comparison |
//! | `&&`, `\|\|`, `!`, `( )` | boolean composition (`&&`/`\|\|` short-circuit: a dead RHS is parsed but never resolved) |
//!
//! Fail-loud: any unparseable or unsupported condition returns `Err(String)`.
//! The runner MUST treat that `Err` as a step failure, never as a silent pass.

use std::collections::HashMap;

use super::condition_lexer::{tokenize, Token};
use super::expressions::{self, WorkflowOutputs};

/// Evaluate a step's `if:` condition to a boolean.
///
/// `any_failed` carries the workflow's cumulative failure state so that
/// `success()` / `failure()` resolve correctly. On any malformed or
/// unsupported input this returns `Err` — callers must surface it as a
/// step failure rather than defaulting to "run the step".
pub fn evaluate_condition(
    condition: &str,
    outputs: &WorkflowOutputs,
    env: &HashMap<String, String>,
    any_failed: bool,
) -> Result<bool, String> {
    let stripped = strip_outer_wrapper(condition.trim());
    let tokens = tokenize(stripped)?;
    let mut parser = Parser {
        tokens,
        pos: 0,
        outputs,
        env,
        any_failed,
    };
    let value = parser.parse_expr(0, 0, false)?;
    if parser.pos != parser.tokens.len() {
        return Err(format!(
            "Unexpected trailing tokens in condition: {}",
            condition
        ));
    }
    Ok(value.truthy())
}

/// Strip exactly one outer `${{ ... }}` wrapper if the entire (trimmed)
/// condition is a single such expression. Inner `${{ ... }}` refs are left
/// for the operand resolver.
fn strip_outer_wrapper(s: &str) -> &str {
    if let Some(inner) = s.strip_prefix("${{") {
        if let Some(inner) = inner.strip_suffix("}}") {
            // Only strip if there's no nested `}}` that would close earlier,
            // i.e. the wrapper spans the whole string. `find("}}")` on the
            // inner body must be None for this to be a single outer wrapper.
            if !inner.contains("}}") {
                return inner.trim();
            }
        }
    }
    s
}

// === Values ===

#[derive(Debug, Clone, PartialEq)]
enum Value {
    Bool(bool),
    /// String operand (also covers resolved refs and quoted literals).
    Str(String),
}

impl Value {
    fn truthy(&self) -> bool {
        match self {
            Value::Bool(b) => *b,
            // A string operand standing alone is truthy when non-empty and
            // not a falsy literal. This mirrors GitHub Actions treating
            // non-empty strings as truthy.
            Value::Str(s) => {
                let t = s.trim();
                !t.is_empty() && !t.eq_ignore_ascii_case("false") && t != "0"
            }
        }
    }

    fn as_string(&self) -> String {
        match self {
            Value::Bool(b) => b.to_string(),
            Value::Str(s) => s.clone(),
        }
    }

    fn as_number(&self) -> Option<f64> {
        match self {
            Value::Bool(_) => None,
            Value::Str(s) => s.trim().parse::<f64>().ok(),
        }
    }
}

// === Parser (Pratt) ===
// Tokens come from `condition_lexer::tokenize` (split into a sibling module
// to keep this file within the size ratchet).

/// Maximum nesting depth for the recursive-descent / Pratt parser.
///
/// Every prefix `!`, parenthesized group, and binary sub-expression recurses,
/// so a crafted condition (e.g. thousands of nested parens or a long run of
/// `!`) could otherwise blow the stack — a DoS via a malicious workflow file.
/// Real conditions never nest more than a handful of levels; 100 is comfortably
/// above any legitimate use yet well below the native stack-overflow threshold.
/// On overflow the parser returns `Err`, which the runner surfaces as a step
/// failure (fail-loud), never as a silent pass.
const MAX_PARSE_DEPTH: usize = 100;

struct Parser<'a> {
    tokens: Vec<Token>,
    pos: usize,
    outputs: &'a WorkflowOutputs,
    env: &'a HashMap<String, String>,
    any_failed: bool,
}

impl Parser<'_> {
    fn peek_tok(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    /// Binding power for binary operators. Higher binds tighter.
    /// `||` < `&&` < comparisons.
    fn binary_bp(tok: &Token) -> Option<u8> {
        match tok {
            Token::Or => Some(1),
            Token::And => Some(2),
            Token::Eq | Token::Ne | Token::Gt | Token::Lt | Token::Ge | Token::Le => Some(3),
            _ => None,
        }
    }

    /// Parse (and evaluate) an expression. When `skip` is true the tokens are
    /// consumed with full syntax checking but nothing is *evaluated*: operand
    /// resolution and operator application are bypassed, so a dead branch of
    /// `&&` / `||` (GitHub-Actions-style short-circuit) cannot fail the
    /// condition via a missing reference or type error. Syntax errors still
    /// surface — short-circuiting skips evaluation, never parsing.
    fn parse_expr(&mut self, min_bp: u8, depth: usize, skip: bool) -> Result<Value, String> {
        if depth > MAX_PARSE_DEPTH {
            return Err(format!(
                "Condition nesting too deep (max {})",
                MAX_PARSE_DEPTH
            ));
        }
        let mut lhs = self.parse_prefix(depth + 1, skip)?;

        while let Some(tok) = self.peek_tok() {
            let Some(bp) = Self::binary_bp(tok) else {
                break;
            };
            if bp < min_bp {
                break;
            }
            // Clone the peeked operator and consume it in one step — no second
            // lookup that could panic if peek and advance ever disagreed
            // (release builds abort on panic; this parser sees user input).
            let op = tok.clone();
            self.pos += 1;
            // Short-circuit: once the LHS decides an `&&` / `||`, the RHS is
            // parsed in skip mode (dead branch).
            let rhs_skip = skip
                || match op {
                    Token::And => !lhs.truthy(),
                    Token::Or => lhs.truthy(),
                    _ => false,
                };
            let rhs = self.parse_expr(bp + 1, depth + 1, rhs_skip)?;
            lhs = if skip {
                // Dead branch: keep parsing, never evaluate. The value is a
                // placeholder the caller discards.
                Value::Bool(false)
            } else {
                match op {
                    Token::And => Value::Bool(lhs.truthy() && !rhs_skip && rhs.truthy()),
                    Token::Or => Value::Bool(lhs.truthy() || (!rhs_skip && rhs.truthy())),
                    _ => self.apply_binary(&op, lhs, rhs)?,
                }
            };
        }

        Ok(lhs)
    }

    fn parse_prefix(&mut self, depth: usize, skip: bool) -> Result<Value, String> {
        if depth > MAX_PARSE_DEPTH {
            return Err(format!(
                "Condition nesting too deep (max {})",
                MAX_PARSE_DEPTH
            ));
        }
        match self.advance() {
            Some(Token::Not) => {
                let v = self.parse_prefix(depth + 1, skip)?;
                Ok(Value::Bool(!v.truthy()))
            }
            Some(Token::LParen) => {
                let v = self.parse_expr(0, depth + 1, skip)?;
                match self.advance() {
                    Some(Token::RParen) => Ok(v),
                    _ => Err("Expected ')'".to_string()),
                }
            }
            Some(Token::Operand { text, is_ref }) => {
                if skip {
                    // Dead branch: syntax-check only; never resolve references
                    // or literals, so a missing ref cannot fail the condition.
                    return Ok(Value::Bool(false));
                }
                self.resolve_operand(&text, is_ref)
            }
            Some(other) => Err(format!(
                "Unexpected operator where operand expected: {:?}",
                other
            )),
            None => Err("Unexpected end of condition".to_string()),
        }
    }

    /// Resolve an operand token to a `Value`.
    fn resolve_operand(&self, text: &str, is_ref: bool) -> Result<Value, String> {
        if !is_ref {
            // Quoted string literal — verbatim.
            return Ok(Value::Str(text.to_string()));
        }

        let t = text.trim();

        // Boolean / truthy literals (case-insensitive for true/false).
        if t.eq_ignore_ascii_case("true") {
            return Ok(Value::Bool(true));
        }
        if t.eq_ignore_ascii_case("false") {
            return Ok(Value::Bool(false));
        }
        if t == "1" {
            return Ok(Value::Bool(true));
        }
        if t == "0" {
            return Ok(Value::Bool(false));
        }

        // Status functions.
        match t {
            "success()" => return Ok(Value::Bool(!self.any_failed)),
            "failure()" => return Ok(Value::Bool(self.any_failed)),
            "always()" => return Ok(Value::Bool(true)),
            _ => {}
        }

        // Plain number operand.
        if t.parse::<f64>().is_ok() {
            return Ok(Value::Str(t.to_string()));
        }

        // Reference: `${{ ... }}`, `steps.X...`, or `env.NAME`. Reuse the
        // expression resolver; wrap bare refs in `${{ }}` so it accepts them.
        let to_resolve = if t.starts_with("${{") {
            t.to_string()
        } else if t.starts_with("steps.") || t.starts_with("env.") {
            format!("${{{{ {} }}}}", t)
        } else {
            return Err(format!("Unsupported operand in condition: '{}'", t));
        };

        expressions::resolve(&to_resolve, self.outputs, self.env)
            .map(Value::Str)
            .map_err(|e| format!("Condition reference failed: {}", e))
    }

    /// Apply a comparison operator. `&&` / `||` are handled (with
    /// short-circuit) directly in `parse_expr` and never reach here.
    fn apply_binary(&self, op: &Token, lhs: Value, rhs: Value) -> Result<Value, String> {
        match op {
            Token::Eq | Token::Ne => {
                let eq = match (lhs.as_number(), rhs.as_number()) {
                    (Some(a), Some(b)) => a == b,
                    _ => lhs.as_string() == rhs.as_string(),
                };
                Ok(Value::Bool(if matches!(op, Token::Eq) { eq } else { !eq }))
            }
            Token::Gt | Token::Lt | Token::Ge | Token::Le => {
                let a = lhs.as_number().ok_or_else(|| {
                    format!("Non-numeric operand in comparison: '{}'", lhs.as_string())
                })?;
                let b = rhs.as_number().ok_or_else(|| {
                    format!("Non-numeric operand in comparison: '{}'", rhs.as_string())
                })?;
                let result = match op {
                    Token::Gt => a > b,
                    Token::Lt => a < b,
                    Token::Ge => a >= b,
                    Token::Le => a <= b,
                    // Defensive: the outer arm restricts `op` to the four
                    // comparison tokens, but this parser runs on user-authored
                    // workflow YAML and the release profile aborts on panic —
                    // fail with a parse error, never `unreachable!()`.
                    other => {
                        return Err(format!("Unexpected comparison operator: {:?}", other));
                    }
                };
                Ok(Value::Bool(result))
            }
            other => Err(format!("Unexpected binary operator: {:?}", other)),
        }
    }
}

#[cfg(test)]
#[path = "condition.test.rs"]
mod tests;

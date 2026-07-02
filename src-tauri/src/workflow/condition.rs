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
//! | `&&`, `\|\|`, `!`, `( )` | boolean composition |
//!
//! Fail-loud: any unparseable or unsupported condition returns `Err(String)`.
//! The runner MUST treat that `Err` as a step failure, never as a silent pass.

use std::collections::HashMap;

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
    let value = parser.parse_expr(0, 0)?;
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

// === Tokens ===

#[derive(Debug, Clone, PartialEq)]
enum Token {
    /// Reference / literal operand text, resolved lazily at eval time.
    /// `is_ref` distinguishes a quoted string literal (false) from a bare
    /// identifier or `${{ }}` reference (true).
    Operand {
        text: String,
        is_ref: bool,
    },
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    And,
    Or,
    Not,
    LParen,
    RParen,
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }

        match c {
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }
            '!' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Ne);
                    i += 2;
                } else {
                    tokens.push(Token::Not);
                    i += 1;
                }
            }
            '=' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Eq);
                    i += 2;
                } else {
                    return Err("Unexpected '=' (did you mean '=='?)".to_string());
                }
            }
            '>' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Ge);
                    i += 2;
                } else {
                    tokens.push(Token::Gt);
                    i += 1;
                }
            }
            '<' => {
                if peek(&chars, i + 1) == Some('=') {
                    tokens.push(Token::Le);
                    i += 2;
                } else {
                    tokens.push(Token::Lt);
                    i += 1;
                }
            }
            '&' => {
                if peek(&chars, i + 1) == Some('&') {
                    tokens.push(Token::And);
                    i += 2;
                } else {
                    return Err("Unexpected '&' (did you mean '&&'?)".to_string());
                }
            }
            '|' => {
                if peek(&chars, i + 1) == Some('|') {
                    tokens.push(Token::Or);
                    i += 2;
                } else {
                    return Err("Unexpected '|' (did you mean '||'?)".to_string());
                }
            }
            '\'' | '"' => {
                let quote = c;
                let mut s = String::new();
                i += 1;
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == quote {
                        closed = true;
                        i += 1;
                        break;
                    }
                    s.push(chars[i]);
                    i += 1;
                }
                if !closed {
                    return Err(format!("Unterminated string literal: {}{}", quote, s));
                }
                tokens.push(Token::Operand {
                    text: s,
                    is_ref: false,
                });
            }
            '$' if peek(&chars, i + 1) == Some('{') && peek(&chars, i + 2) == Some('{') => {
                // `${{ ... }}` reference operand — capture up to the matching `}}`.
                let start = i;
                i += 3;
                let mut closed = false;
                while i < chars.len() {
                    if chars[i] == '}' && peek(&chars, i + 1) == Some('}') {
                        i += 2;
                        closed = true;
                        break;
                    }
                    i += 1;
                }
                if !closed {
                    return Err("Unterminated `${{` reference".to_string());
                }
                let text: String = chars[start..i].iter().collect();
                tokens.push(Token::Operand { text, is_ref: true });
            }
            _ => {
                // Bare operand: identifier path, number, or status function.
                // Allowed chars: letters, digits, `.`, `_`, `-`. We stop at
                // any operator, paren, or whitespace — except an immediately
                // trailing `()` is consumed so status functions like
                // `success()` tokenize as a single operand. A standalone `(`
                // or `)` is left for the grouping branches above.
                let start = i;
                while i < chars.len() {
                    let ch = chars[i];
                    if ch.is_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                        i += 1;
                    } else {
                        break;
                    }
                }
                // Consume a trailing `()` for function-call syntax only.
                if peek(&chars, i) == Some('(') && peek(&chars, i + 1) == Some(')') {
                    i += 2;
                }
                let text: String = chars[start..i].iter().collect();
                if text.is_empty() {
                    return Err(format!("Unexpected character '{}' in condition", c));
                }
                tokens.push(Token::Operand { text, is_ref: true });
            }
        }
    }

    if tokens.is_empty() {
        return Err("Empty condition".to_string());
    }

    Ok(tokens)
}

fn peek(chars: &[char], idx: usize) -> Option<char> {
    chars.get(idx).copied()
}

// === Parser (Pratt) ===

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

    fn parse_expr(&mut self, min_bp: u8, depth: usize) -> Result<Value, String> {
        if depth > MAX_PARSE_DEPTH {
            return Err(format!(
                "Condition nesting too deep (max {})",
                MAX_PARSE_DEPTH
            ));
        }
        let mut lhs = self.parse_prefix(depth + 1)?;

        while let Some(tok) = self.peek_tok() {
            let Some(bp) = Self::binary_bp(tok) else {
                break;
            };
            if bp < min_bp {
                break;
            }
            let op = self.advance().expect("peeked token exists");
            let rhs = self.parse_expr(bp + 1, depth + 1)?;
            lhs = self.apply_binary(&op, lhs, rhs)?;
        }

        Ok(lhs)
    }

    fn parse_prefix(&mut self, depth: usize) -> Result<Value, String> {
        if depth > MAX_PARSE_DEPTH {
            return Err(format!(
                "Condition nesting too deep (max {})",
                MAX_PARSE_DEPTH
            ));
        }
        match self.advance() {
            Some(Token::Not) => {
                let v = self.parse_prefix(depth + 1)?;
                Ok(Value::Bool(!v.truthy()))
            }
            Some(Token::LParen) => {
                let v = self.parse_expr(0, depth + 1)?;
                match self.advance() {
                    Some(Token::RParen) => Ok(v),
                    _ => Err("Expected ')'".to_string()),
                }
            }
            Some(Token::Operand { text, is_ref }) => self.resolve_operand(&text, is_ref),
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

    fn apply_binary(&self, op: &Token, lhs: Value, rhs: Value) -> Result<Value, String> {
        match op {
            Token::And => Ok(Value::Bool(lhs.truthy() && rhs.truthy())),
            Token::Or => Ok(Value::Bool(lhs.truthy() || rhs.truthy())),
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
                    _ => unreachable!(),
                };
                Ok(Value::Bool(result))
            }
            other => Err(format!("Unexpected binary operator: {:?}", other)),
        }
    }
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

    fn eval(cond: &str, any_failed: bool) -> Result<bool, String> {
        evaluate_condition(cond, &HashMap::new(), &HashMap::new(), any_failed)
    }

    // === literals ===

    #[test]
    fn literal_true() {
        assert!(eval("true", false).unwrap());
        assert!(eval("TRUE", false).unwrap());
        assert!(eval("1", false).unwrap());
    }

    #[test]
    fn literal_false() {
        assert!(!eval("false", false).unwrap());
        assert!(!eval("False", false).unwrap());
        assert!(!eval("0", false).unwrap());
    }

    // === status functions ===

    #[test]
    fn success_function() {
        assert!(eval("success()", false).unwrap());
        assert!(!eval("success()", true).unwrap());
    }

    #[test]
    fn failure_function() {
        assert!(!eval("failure()", false).unwrap());
        assert!(eval("failure()", true).unwrap());
    }

    #[test]
    fn always_function() {
        assert!(eval("always()", false).unwrap());
        assert!(eval("always()", true).unwrap());
    }

    // === string equality ===

    #[test]
    fn string_equality() {
        assert!(eval("'ok' == 'ok'", false).unwrap());
        assert!(!eval("'ok' == 'no'", false).unwrap());
        assert!(eval("\"a\" != \"b\"", false).unwrap());
        assert!(!eval("'a' != 'a'", false).unwrap());
    }

    // === numeric comparisons ===

    #[test]
    fn numeric_comparisons() {
        assert!(eval("9 > 5", false).unwrap());
        assert!(!eval("5 > 9", false).unwrap());
        assert!(eval("5 < 9", false).unwrap());
        assert!(eval("5 >= 5", false).unwrap());
        assert!(eval("5 <= 5", false).unwrap());
        assert!(eval("3.5 > 3", false).unwrap());
    }

    #[test]
    fn numeric_equality_prefers_number() {
        // "9" == "9.0" should be true numerically though strings differ.
        assert!(eval("9 == 9.0", false).unwrap());
        assert!(eval("9 != 8", false).unwrap());
    }

    #[test]
    fn non_numeric_comparison_errors() {
        let r = eval("'abc' > 5", false);
        assert!(r.is_err(), "expected Err, got {:?}", r);
    }

    // === boolean composition ===

    #[test]
    fn boolean_and_or_not() {
        assert!(eval("true && true", false).unwrap());
        assert!(!eval("true && false", false).unwrap());
        assert!(eval("false || true", false).unwrap());
        assert!(!eval("false || false", false).unwrap());
        assert!(eval("!false", false).unwrap());
        assert!(!eval("!true", false).unwrap());
    }

    #[test]
    fn precedence_and_binds_tighter_than_or() {
        // false || (true && true) => true
        assert!(eval("false || true && true", false).unwrap());
        // (true && false) || false => false
        assert!(!eval("true && false || false", false).unwrap());
    }

    #[test]
    fn parentheses_override_precedence() {
        // (false || true) && false => false
        assert!(!eval("(false || true) && false", false).unwrap());
        // !(false) => true
        assert!(eval("!(false)", false).unwrap());
    }

    #[test]
    fn comparison_combined_with_boolean() {
        assert!(eval("9 > 5 && 'a' == 'a'", false).unwrap());
        assert!(!eval("9 < 5 || 'a' == 'b'", false).unwrap());
    }

    // === reference resolution ===

    #[test]
    fn ref_in_condition_equality() {
        let o = outputs(&[("first", &[("status", "ok")])]);
        let r = evaluate_condition(
            "${{ steps.first.outputs.status }} == 'ok'",
            &o,
            &HashMap::new(),
            false,
        )
        .unwrap();
        assert!(r);
    }

    #[test]
    fn bare_ref_in_condition() {
        let o = outputs(&[("first", &[("score", "42")])]);
        let r = evaluate_condition("steps.first.outputs.score > 10", &o, &HashMap::new(), false)
            .unwrap();
        assert!(r);
    }

    #[test]
    fn env_ref_in_condition() {
        let e = env(&[("STAGE", "prod")]);
        let r = evaluate_condition("env.STAGE == 'prod'", &HashMap::new(), &e, false).unwrap();
        assert!(r);
    }

    #[test]
    fn ref_resolution_failure_is_error() {
        // Unknown step → expressions::resolve returns Err → we surface Err.
        let r = evaluate_condition(
            "${{ steps.ghost.outputs.x }} == 'ok'",
            &HashMap::new(),
            &HashMap::new(),
            false,
        );
        assert!(r.is_err(), "expected Err, got {:?}", r);
    }

    // === outer wrapper stripping ===

    #[test]
    fn strips_outer_wrapper() {
        let o = outputs(&[("first", &[("status", "ok")])]);
        let r = evaluate_condition(
            "${{ steps.first.outputs.status == 'ok' }}",
            &o,
            &HashMap::new(),
            false,
        )
        .unwrap();
        assert!(r);
    }

    #[test]
    fn outer_wrapper_with_success() {
        assert!(
            evaluate_condition("${{ success() }}", &HashMap::new(), &HashMap::new(), false)
                .unwrap()
        );
    }

    // === fail-loud on garbage ===

    #[test]
    fn garbage_input_errors() {
        assert!(eval("this is not @ valid", false).is_err());
        assert!(eval("==", false).is_err());
        assert!(eval("(true", false).is_err());
        assert!(eval("true &&", false).is_err());
        assert!(eval("", false).is_err());
        assert!(eval("true true", false).is_err());
    }

    #[test]
    fn unsupported_operand_errors() {
        // `secrets.X` is not a supported reference root.
        let r = eval("secrets.API == 'x'", false);
        assert!(r.is_err(), "expected Err, got {:?}", r);
    }

    #[test]
    fn unterminated_string_errors() {
        assert!(eval("'unterminated", false).is_err());
    }

    // === recursion-depth cap (DoS guard) ===

    #[test]
    fn deeply_nested_parens_errors_not_overflows() {
        // Far beyond MAX_PARSE_DEPTH: a crafted workflow could otherwise
        // stack-overflow the backend. Must return Err, never panic/abort.
        let depth = 5000;
        let cond = format!("{}true{}", "(".repeat(depth), ")".repeat(depth));
        let r = eval(&cond, false);
        assert!(r.is_err(), "expected Err for deep parens, got {:?}", r);
    }

    #[test]
    fn long_not_run_errors_not_overflows() {
        // A long run of prefix `!` recurses via parse_prefix on every `!`.
        let cond = format!("{}true", "!".repeat(5000));
        let r = eval(&cond, false);
        assert!(r.is_err(), "expected Err for long `!` run, got {:?}", r);
    }

    #[test]
    fn normal_nesting_still_evaluates() {
        // A few legitimate levels must keep working.
        assert!(eval("(((true)))", false).unwrap());
        assert!(eval("!!!false", false).unwrap());
        assert!(eval("((true && false) || (true && true))", false).unwrap());
        // true && (false||false) => false; ||false => false; !false => true
        assert!(eval("!(true && (false || false) || false)", false).unwrap());
    }
}

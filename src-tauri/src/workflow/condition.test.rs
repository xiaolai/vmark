//! Unit tests for the workflow `if:` condition evaluator (see
//! `condition.rs`). Split into a sibling file (included via `#[path]`)
//! to keep the production file under the size gate.

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
    let r =
        evaluate_condition("steps.first.outputs.score > 10", &o, &HashMap::new(), false).unwrap();
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
        evaluate_condition("${{ success() }}", &HashMap::new(), &HashMap::new(), false).unwrap()
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

// === parser robustness: malformed input must Err, never panic ===
// The release profile uses `panic = "abort"`, so any reachable panic in
// this user-authored-YAML parser would hard-crash the whole app.

#[test]
fn truncated_expressions_error_not_panic() {
    assert!(eval("9 >", false).is_err());
    assert!(eval("'a' ==", false).is_err());
    assert!(eval("true || ", false).is_err());
    assert!(eval("!", false).is_err());
    assert!(eval("(", false).is_err());
    assert!(eval("()", false).is_err());
    assert!(eval("(true &&", false).is_err());
}

#[test]
fn operator_only_inputs_error_not_panic() {
    for cond in [">", "<", ">=", "<=", "==", "!=", "&&", "||", "! &&"] {
        assert!(eval(cond, false).is_err(), "expected Err for {cond:?}");
    }
}

#[test]
fn operand_where_operator_expected_errors() {
    assert!(eval("5 > > 3", false).is_err());
    assert!(eval("true && || false", false).is_err());
    assert!(eval(") true", false).is_err());
}

#[test]
fn adversarial_unicode_errors_or_evaluates_without_panic() {
    // Bare CJK identifier: alphanumeric per Unicode, so it tokenizes as a
    // reference operand and then fails resolution — an Err, not a panic.
    assert!(eval("\u{771f} == '\u{771f}'", false).is_err());
    // Non-alphanumeric symbol (emoji): unexpected-character error.
    assert!(eval("\u{1f680} && true", false).is_err());
    // Unicode inside quoted literals stays fully supported.
    assert!(eval(
        "'h\u{e9}llo \u{4e16}\u{754c}' == 'h\u{e9}llo \u{4e16}\u{754c}'",
        false
    )
    .unwrap());
    // RTL text in literals.
    assert!(eval("'\u{5e9}\u{5dc}\u{5d5}\u{5dd}' != 'hello'", false).unwrap());
}

// === short-circuit semantics (GitHub-Actions-style) ===
// `&&` / `||` must not resolve (or otherwise evaluate) the RHS when the LHS
// already decides the result — a dead branch containing a missing reference
// or an invalid comparison must not fail the condition.

#[test]
fn or_short_circuits_missing_ref_on_true_lhs() {
    assert!(eval("true || steps.missing.outputs.x", false).unwrap());
    assert!(eval("${{ true || steps.missing.outputs.x }}", false).unwrap());
}

#[test]
fn and_short_circuits_missing_ref_on_false_lhs() {
    assert!(!eval("false && steps.missing.outputs.x", false).unwrap());
}

#[test]
fn live_rhs_missing_ref_still_errors() {
    // The RHS IS evaluated here, so the missing reference must still fail loud.
    let r = eval("false || steps.missing.outputs.x", false);
    assert!(r.is_err(), "expected Err, got {:?}", r);
    let r = eval("true && steps.missing.outputs.x", false);
    assert!(r.is_err(), "expected Err, got {:?}", r);
}

#[test]
fn dead_branch_invalid_comparison_is_skipped() {
    // `'abc' > 5` is a type error when evaluated, but it sits in a dead branch.
    assert!(!eval("false && 'abc' > 5", false).unwrap());
    assert!(eval("true || 'abc' > 5", false).unwrap());
}

#[test]
fn dead_branch_syntax_errors_still_error() {
    // Short-circuiting skips evaluation, not parsing — malformed input in a
    // dead branch is still a malformed condition.
    assert!(eval("true || (steps.missing.outputs.x", false).is_err());
    assert!(eval("false && ==", false).is_err());
    assert!(eval("true ||", false).is_err());
}

#[test]
fn short_circuit_chains_left_to_right() {
    // In `false && X || true`, `&&` binds tighter: (false && X) || true.
    assert!(eval("false && steps.missing.outputs.x || true", false).unwrap());
    // (true || X) && true — the dead ref sits inside the parenthesized LHS.
    assert!(eval("(true || steps.missing.outputs.x) && true", false).unwrap());
    // Nested dead group: everything inside the group is skipped.
    assert!(!eval(
        "false && (steps.missing.outputs.x == 'a' || env.NOPE > 3)",
        false
    )
    .unwrap());
}

#[test]
fn short_circuit_with_resolved_refs_keeps_values() {
    // A real ref on the LHS drives the short-circuit decision.
    let o = outputs(&[("first", &[("status", "ok")])]);
    // truthy ref || missing ref → true without touching the missing ref.
    assert!(evaluate_condition(
        "steps.first.outputs.status || steps.missing.outputs.x",
        &o,
        &HashMap::new(),
        false,
    )
    .unwrap());
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

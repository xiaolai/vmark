//! Tests for the installed-font-family listing (#1429).

use super::normalize;

#[test]
fn sorts_case_insensitively() {
    let sorted = normalize(vec![
        "zapfino".to_string(),
        "Arial".to_string(),
        "menlo".to_string(),
    ]);
    assert_eq!(sorted, vec!["Arial", "menlo", "zapfino"]);
}

#[test]
fn drops_apples_hidden_dot_families() {
    // `.SF NS Mono` and friends do not match by family name in WebKit, so
    // offering one would be offering a choice that silently does nothing.
    let sorted = normalize(vec![
        ".SF NS Mono".to_string(),
        ".AppleSystemUIFont".to_string(),
        "Menlo".to_string(),
    ]);
    assert_eq!(sorted, vec!["Menlo"]);
}

#[test]
fn drops_empty_names() {
    assert_eq!(
        normalize(vec![String::new(), "Menlo".to_string()]),
        vec!["Menlo"]
    );
}

#[test]
fn removes_duplicates() {
    let sorted = normalize(vec![
        "Menlo".to_string(),
        "Menlo".to_string(),
        "Monaco".to_string(),
    ]);
    assert_eq!(sorted, vec!["Menlo", "Monaco"]);
}

#[test]
fn orders_case_variants_deterministically() {
    // Equal under lowercase — the tiebreak keeps the order stable rather than
    // leaving it to the sort's implementation, so `dedup` cannot drop a
    // different one from run to run.
    let sorted = normalize(vec!["menlo".to_string(), "Menlo".to_string()]);
    assert_eq!(sorted, vec!["Menlo", "menlo"]);
}

#[test]
fn empty_input_is_an_empty_list_not_an_error() {
    assert!(normalize(Vec::new()).is_empty());
}

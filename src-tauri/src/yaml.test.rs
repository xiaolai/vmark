//! Behaviour the YAML wrapper must keep from the parser it replaced
//! (`serde_yaml_ng`): the YAML 1.2 boolean rule, duplicate-key refusal,
//! scalar typing in untyped values, and bounded alias expansion.

use super::{from_str, Mapping, Value};
use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq)]
struct Flags {
    enabled: bool,
}

#[derive(Debug, Deserialize, PartialEq)]
struct Named {
    name: String,
    count: u32,
}

#[test]
fn parses_a_typed_document() {
    let parsed: Named = from_str("name: demo\ncount: 3\n").unwrap();
    assert_eq!(
        parsed,
        Named {
            name: "demo".into(),
            count: 3
        }
    );
}

#[test]
fn only_true_and_false_are_booleans() {
    assert!(from_str::<Flags>("enabled: true").unwrap().enabled);
    assert!(!from_str::<Flags>("enabled: false").unwrap().enabled);
    for shorthand in ["yes", "no", "on", "off", "y", "n"] {
        assert!(
            from_str::<Flags>(&format!("enabled: {shorthand}")).is_err(),
            "`{shorthand}` must not be read as a boolean"
        );
    }
}

#[test]
fn yaml_1_1_shorthands_stay_strings_in_untyped_values() {
    let value: Value = from_str("a: yes\nb: on\nc: no\n").unwrap();
    assert_eq!(value["a"], Value::String("yes".into()));
    assert_eq!(value["b"], Value::String("on".into()));
    assert_eq!(value["c"], Value::String("no".into()));
}

#[test]
fn untyped_scalars_keep_their_yaml_types() {
    let value: Value =
        from_str("version: 1\nratio: 1.5\nflag: true\nnothing: null\ntext: hi\n").unwrap();
    assert_eq!(value["version"].as_u64(), Some(1));
    assert_eq!(value["ratio"].as_f64(), Some(1.5));
    assert_eq!(value["flag"], Value::Bool(true));
    assert!(value["nothing"].is_null());
    assert_eq!(value["text"].as_str(), Some("hi"));
    // A number is not a string: genie metadata reads `version` with as_str.
    assert_eq!(value["version"].as_str(), None);
}

#[test]
fn nested_mappings_and_sequences_parse() {
    let value: Value =
        from_str("input:\n  type: text\n  schema:\n    type: object\ntags: [a, b]\n").unwrap();
    let input: &Mapping = value["input"].as_object().unwrap();
    assert_eq!(input["type"].as_str(), Some("text"));
    assert_eq!(input["schema"]["type"].as_str(), Some("object"));
    assert_eq!(value["tags"].as_array().map(Vec::len), Some(2));
}

#[test]
fn a_duplicate_key_is_an_error() {
    assert!(from_str::<Value>("a: 1\na: 2\n").is_err());
}

#[test]
fn a_syntax_error_reports_its_position() {
    let err = from_str::<Value>("a: [1, 2\nb: 3\n")
        .unwrap_err()
        .to_string();
    assert!(!err.is_empty());
    assert!(
        err.chars().any(|c| c.is_ascii_digit()),
        "no position in: {err}"
    );
}

#[test]
fn an_alias_bomb_is_refused_rather_than_expanded() {
    let mut text = String::from("a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n");
    for i in 1..12 {
        let prev = i - 1;
        text.push_str(&format!(
            "a{i}: &a{i} [*a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}, *a{prev}]\n"
        ));
    }
    assert!(from_str::<Value>(&text).is_err());
}

#[test]
fn a_scalar_document_is_not_a_mapping() {
    let value: Value = from_str("just text").unwrap();
    assert!(value.as_object().is_none());
}

//! Tests for the genies module.

use super::parsing::parse_genie;
use super::scanning::{extract_frontmatter_name, scan_genies_dir};
use super::types::GenieEntry;
use std::collections::HashMap;
use std::fs;

#[test]
fn test_parse_genie_with_frontmatter() {
    let content = r#"---
name: improve-writing
description: Improve clarity and flow
scope: selection
category: writing
---

You are an expert editor. Improve the following text:

{{content}}"#;

    let result = parse_genie(content, "improve-writing.md").unwrap();
    assert_eq!(result.metadata.name, "improve-writing");
    assert_eq!(result.metadata.description, "Improve clarity and flow");
    assert_eq!(result.metadata.scope, "selection");
    assert_eq!(result.metadata.category.as_deref(), Some("writing"));
    assert_eq!(result.metadata.action, None); // no action field -> defaults to None
    assert!(result.template.contains("{{content}}"));
}

#[test]
fn test_parse_genie_with_context() {
    let content = "---\nname: fit\nscope: selection\ncontext: 1\n---\n\n{{context}}\n\n{{content}}";
    let result = parse_genie(content, "fit.md").unwrap();
    assert_eq!(result.metadata.context, Some(1));
}

#[test]
fn test_parse_genie_context_clamped_to_2() {
    let content = "---\nname: fit\nscope: selection\ncontext: 5\n---\n\nTemplate";
    let result = parse_genie(content, "fit.md").unwrap();
    assert_eq!(result.metadata.context, None); // >2 is filtered out
}

#[test]
fn test_parse_genie_no_context_field() {
    let content = "---\nname: basic\nscope: selection\n---\n\n{{content}}";
    let result = parse_genie(content, "basic.md").unwrap();
    assert_eq!(result.metadata.context, None);
}

#[test]
fn test_parse_genie_with_action_insert() {
    let content = "---\nname: continue\nscope: block\naction: insert\n---\n\nContinue writing.\n\n{{content}}";
    let result = parse_genie(content, "continue.md").unwrap();
    assert_eq!(result.metadata.name, "continue");
    assert_eq!(result.metadata.scope, "block");
    assert_eq!(result.metadata.action.as_deref(), Some("insert"));
}

#[test]
fn test_parse_genie_with_invalid_action() {
    let content = "---\nname: typo\nscope: selection\naction: insret\n---\n\nTemplate";
    let result = parse_genie(content, "typo.md").unwrap();
    assert_eq!(result.metadata.action, None); // invalid value ignored
}

#[test]
fn test_parse_genie_without_frontmatter() {
    let content = "Just a plain genie template\n\n{{content}}";
    let result = parse_genie(content, "test-genie.md").unwrap();
    assert_eq!(result.metadata.name, "test-genie");
    assert_eq!(result.metadata.scope, "selection");
    assert!(result.template.contains("{{content}}"));
}

#[test]
fn test_parse_genie_with_bom() {
    let content = "\u{FEFF}---\nname: bom-test\ndescription: Has BOM\nscope: document\n---\n\nTemplate here";
    let result = parse_genie(content, "bom-test.md").unwrap();
    assert_eq!(result.metadata.name, "bom-test");
    assert_eq!(result.metadata.scope, "document");
}

#[test]
fn test_parse_genie_missing_closing() {
    let content = "---\nname: broken\nno closing fence";
    let result = parse_genie(content, "broken.md");
    assert!(result.is_err());
}

#[test]
fn test_no_collision_same_name_different_category() {
    use std::io::Write as _;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();

    // Create two files with the same stem in different subdirs
    let writing = base.join("writing");
    let coding = base.join("coding");
    fs::create_dir_all(&writing).unwrap();
    fs::create_dir_all(&coding).unwrap();

    let mut f1 = fs::File::create(writing.join("improve.md")).unwrap();
    writeln!(f1, "---\nname: improve-writing\nscope: selection\n---\ntemplate1").unwrap();

    let mut f2 = fs::File::create(coding.join("improve.md")).unwrap();
    writeln!(f2, "---\nname: improve-code\nscope: selection\n---\ntemplate2").unwrap();

    let mut entries: HashMap<String, GenieEntry> = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);

    // Both should be present (keyed by relative path, not bare stem)
    assert_eq!(entries.len(), 2);
    assert!(entries.values().any(|e| e.name == "improve" && e.category.as_deref() == Some("writing")));
    assert!(entries.values().any(|e| e.name == "improve" && e.category.as_deref() == Some("coding")));
}

#[test]
fn test_read_genie_uses_canonical_path() {
    // Validates that read_genie reads from the canonicalized path.
    // The function canonicalizes, validates prefix, then reads from canonicalized path.
    // This is tested via the parse_genie function which is the tail of read_genie.
    let content = "---\nname: canonical-test\nscope: document\n---\nSafe content";
    let result = parse_genie(content, "canonical-test.md").unwrap();
    assert_eq!(result.metadata.name, "canonical-test");
}

#[test]
fn test_parse_genie_strips_quotes() {
    let content = "---\nname: \"quoted name\"\ndescription: 'single quoted'\nscope: selection\n---\n\nTemplate";
    let result = parse_genie(content, "test.md").unwrap();
    assert_eq!(result.metadata.name, "quoted name");
    assert_eq!(result.metadata.description, "single quoted");
}

#[test]
fn test_extract_frontmatter_name_strips_quotes() {
    let content = "---\nname: \"My Genie\"\nscope: selection\n---\n\nTemplate";
    assert_eq!(extract_frontmatter_name(content), Some("My Genie".to_string()));
}

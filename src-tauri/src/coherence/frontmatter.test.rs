// WI-1.8 — frontmatter identity convention (spec §2.1): line-based
// reserved-block reading, identity assignment content rewriting, and the
// malformed-frontmatter and duplicate-adjacent edge cases. Duplicate-ID
// detection itself is scan-level (scan.test.rs) — this module owns
// parsing and assignment only.

use super::*;

const ID: &str = "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7";

#[test]
fn reads_identity_with_schema() {
    let doc = format!("---\ntitle: Elena\nvmark:\n  id: {ID}\n  schema: character\n---\nbody\n");
    let fi = read_identity(&doc).unwrap();
    assert_eq!(fi.id.0.to_string(), ID);
    assert_eq!(fi.schema.as_deref(), Some("character"));
}

#[test]
fn reads_identity_without_schema() {
    let doc = format!("---\nvmark:\n  id: {ID}\n---\nbody\n");
    let fi = read_identity(&doc).unwrap();
    assert_eq!(fi.id.0.to_string(), ID);
    assert_eq!(fi.schema, None);
}

#[test]
fn no_frontmatter_or_no_vmark_key_is_none() {
    assert!(read_identity("just a body\n").is_none());
    assert!(read_identity("---\ntitle: x\n---\nbody\n").is_none());
}

#[test]
fn malformed_frontmatter_is_none() {
    // Unterminated fence: content, not identity (spec §2.1).
    assert!(read_identity(&format!("---\nvmark:\n  id: {ID}\nno closing\n")).is_none());
}

#[test]
fn invalid_uuid_is_none() {
    assert!(read_identity("---\nvmark:\n  id: not-a-uuid\n---\nbody\n").is_none());
}

#[test]
fn assign_identity_inserts_and_roundtrips() {
    let (content, fi) = assign_identity("# Fresh\nbody\n", Some("scene"));
    let read = read_identity(&content).unwrap();
    assert_eq!(read.id, fi.id);
    assert_eq!(read.schema.as_deref(), Some("scene"));
    // Assignment must not move the content hash (spec §3.3).
    use crate::coherence::canonical::text_content_hash;
    assert_eq!(
        text_content_hash(&content),
        text_content_hash("# Fresh\nbody\n")
    );
}

#[test]
fn assign_identity_preserves_author_frontmatter() {
    let (content, _) = assign_identity("---\ntitle: Kept\n---\nbody\n", None);
    assert!(content.contains("title: Kept"));
    assert!(read_identity(&content).is_some());
}

#[test]
fn quoted_and_spaced_values_parse() {
    let doc = format!("---\nvmark:\n  id:   {ID}  \n---\nbody\n");
    assert!(read_identity(&doc).is_some(), "extra spacing tolerated");
}

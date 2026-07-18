// WI-1.3 — canonicalization + identity-masked hashing (spec §3). Includes
// the identity-field exclusion test (§3.3: assigning vmark.id/schema never
// changes the content hash) and golden vectors shared with the G1 probe.

use super::*;

const BARE: &str = "# Scene 12\nElena waited in the rain.\n";
const BARE_HASH: &str = "sha256:e59856b8f84f657f19d657aa2504758f3504e79dcc6e4aa999b0f9125edd4221";
const AUTHOR_FM_HASH: &str = "sha256:56c0dc6798a8150ebd2d806e1903a6e2afc6a43b9c5c332d358b2c3e52b308d2";

#[test]
fn golden_vector_bare_document() {
    assert_eq!(text_content_hash(BARE).as_str(), BARE_HASH);
}

#[test]
fn identity_exclusion_full_frontmatter_matches_author_only() {
    // Adding vmark.id + vmark.schema to author frontmatter must not move
    // the hash (spec §3.3) — golden pair generated with the G1 probe.
    let with_identity = "---\ntitle: Scene\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n  schema: scene\n---\n# Scene 12\nElena waited in the rain.\n";
    let author_only = "---\ntitle: Scene\n---\n# Scene 12\nElena waited in the rain.\n";
    assert_eq!(text_content_hash(with_identity).as_str(), AUTHOR_FM_HASH);
    assert_eq!(text_content_hash(author_only).as_str(), AUTHOR_FM_HASH);
}

#[test]
fn identity_exclusion_synthesized_frontmatter_matches_bare() {
    // A frontmatter block containing ONLY the vmark identity collapses away
    // entirely under masking.
    let only_vmark = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n---\n# Scene 12\nElena waited in the rain.\n";
    assert_eq!(text_content_hash(only_vmark).as_str(), BARE_HASH);
}

#[test]
fn masking_keeps_unknown_vmark_children() {
    // Only id/schema are reserved; other keys under vmark survive masking.
    let doc = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n  future: x\n---\nbody\n";
    let masked = mask_identity(doc);
    assert!(masked.contains("vmark:"), "vmark block kept: {masked:?}");
    assert!(masked.contains("  future: x"));
    assert!(!masked.contains("id:"));
}

#[test]
fn nfc_normalization_unifies_composed_and_decomposed() {
    let composed = "café\n"; // U+00E9
    let decomposed = "cafe\u{0301}\n"; // e + combining acute
    assert_eq!(text_content_hash(composed), text_content_hash(decomposed));
}

#[test]
fn line_endings_normalize_to_lf() {
    assert_eq!(text_content_hash("a\r\nb\r"), text_content_hash("a\nb\n"));
    assert_eq!(canonicalize_text("x\r\ny\rz"), "x\ny\nz");
}

#[test]
fn no_frontmatter_passthrough_and_unterminated_fence_is_content() {
    assert_eq!(mask_identity(BARE), BARE);
    // Unterminated fence: malformed frontmatter is content, not identity
    // (spec §2.1) — masking must leave it untouched.
    let broken = "---\nvmark:\n  id: xyz\nno closing fence\n";
    assert_eq!(mask_identity(broken), broken);
}

#[test]
fn trailing_whitespace_and_final_newline_are_content() {
    assert_ne!(text_content_hash("a\n"), text_content_hash("a"));
    assert_ne!(text_content_hash("a \n"), text_content_hash("a\n"));
}

#[test]
fn binary_detection_and_raw_hashing() {
    assert!(is_probably_binary(&[0xff, 0xfe, 0x00]));
    assert!(!is_probably_binary("plain text".as_bytes()));
    // Binary hashing is raw: no line-ending canonicalization happens.
    let crlf = b"a\r\nb";
    let lf = b"a\nb";
    assert_ne!(binary_content_hash(crlf), binary_content_hash(lf));
    assert_ne!(
        binary_content_hash(crlf).as_str(),
        text_content_hash("a\r\nb").as_str(),
        "text pipeline canonicalizes, binary must not"
    );
}

#[test]
fn masking_is_idempotent() {
    let doc = "---\ntitle: Scene\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n---\nbody\n";
    let once = mask_identity(doc);
    assert_eq!(mask_identity(&once), once);
}

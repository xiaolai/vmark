//! The key-policy review guard: the index header's `keyPolicy` names how a
//! path becomes a key, and an index written under another policy is
//! refused. A change to the code that spells keys or decides which
//! spellings are one document, with the policy left as it was, would replay
//! old keys under new rules and split or merge histories silently. So the
//! policy id is pinned together with a hash of that code (and of the pinned
//! versions of the Unicode crates it folds with), and changing either alone
//! fails here.
//!
//! The hash ignores blank lines, `//` comment lines and line endings, so
//! documentation edits and a CRLF checkout do not trip it.

use crate::agent_journal::doc_index::format::KEY_POLICY;

/// The code that turns a path into a key, or decides alias equality.
const SOURCES: [(&str, &str); 8] = [
    (
        "files/entry_spelling.rs",
        include_str!("../files/entry_spelling.rs"),
    ),
    (
        "files/entry_spelling_stored.rs",
        include_str!("../files/entry_spelling_stored.rs"),
    ),
    (
        "files/path_identity.rs",
        include_str!("../files/path_identity.rs"),
    ),
    ("link_target.rs", include_str!("../link_target.rs")),
    ("agent_journal/doc_key.rs", include_str!("doc_key.rs")),
    (
        "agent_journal/doc_registry_provisional.rs",
        include_str!("doc_registry_provisional.rs"),
    ),
    (
        "agent_journal/doc_index_near.rs",
        include_str!("doc_index_near.rs"),
    ),
    (
        "files/write/lock_key.rs",
        include_str!("../files/write/lock_key.rs"),
    ),
];

/// The lock file, for the Unicode crates `lock_key` folds with.
const LOCK: &str = include_str!("../../Cargo.lock");
const LOCKED_CRATES: [&str; 3] = ["icu_casemap", "icu_casemap_data", "unicode-normalization"];

/// The reviewed policy and the hash of the code it was reviewed against.
const PINNED: (&str, u64) = ("entry-spelling-1", 2837485409781082938);

/// `name`'s `[[package]]` entry in the lock file (version and checksum),
/// line endings aside.
fn locked(name: &str) -> String {
    let lock = LOCK.replace("\r\n", "\n");
    let start = lock
        .find(&format!("[[package]]\nname = \"{name}\"\n"))
        .unwrap_or_else(|| panic!("{name} is not in Cargo.lock"));
    let rest = &lock[start..];
    rest[..rest.find("\n\n").unwrap_or(rest.len())].to_owned()
}

/// FNV-1a over the code lines: stable across Rust versions and platforms.
fn code_hash() -> u64 {
    let locked: Vec<String> = LOCKED_CRATES.iter().map(|name| locked(name)).collect();
    let texts = SOURCES
        .iter()
        .map(|(_, text)| *text)
        .chain(locked.iter().map(String::as_str));
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for text in texts {
        for line in text.lines().map(str::trim_end) {
            let code = line.trim_start();
            if code.is_empty() || code.starts_with("//") {
                continue;
            }
            for b in line.bytes().chain(*b"\n") {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0100_0000_01b3);
            }
        }
    }
    h
}

#[test]
fn the_key_policy_is_reviewed_with_the_code_that_spells_keys() {
    let now = (KEY_POLICY, code_hash());
    assert_eq!(
        now,
        PINNED,
        "The code that turns a path into a document key or decides which \
         spellings are one document changed ({files}; Cargo.lock: {crates}), \
         or KEY_POLICY did. Decide whether any existing path would now get a \
         different key or alias. If one would, bump KEY_POLICY in \
         agent_journal/doc_index_format.rs (an index written under the old \
         policy is then refused, never replayed with new keys). Either way, \
         set PINNED in this file to {now:?}.",
        files = SOURCES.map(|(name, _)| name).join(", "),
        crates = LOCKED_CRATES.join(", "),
    );
}

/// The hash covers each Unicode crate's locked version and checksum, so a
/// bump of the folding data is reviewed like a code change.
#[test]
fn the_folding_crates_locked_versions_are_hashed() {
    for name in LOCKED_CRATES {
        let entry = locked(name);
        assert!(entry.contains("\nversion = \""), "{name}: {entry}");
        assert!(entry.contains("\nchecksum = \""), "{name}: {entry}");
    }
}

//! Tests for `registry.rs` — the persisted list of user-chosen workspace roots.
//!
//! WI-LX1.1 — the list is the ONLY thing `allow_workspace_access` re-grants
//! from, so what it admits, how it matches, and what it refuses to parse are the
//! boundary itself.

use super::{GrantList, FORMAT_MARKER, MAX_FILE_BYTES, MAX_ROOTS};

/// A POSIX-spelled fixture as an ABSOLUTE path on this platform. `/a` is not
/// absolute on Windows (no drive), so written as-is every fixture below would
/// be refused there and each assertion would test an empty list.
fn abs(posix: &str) -> String {
    if cfg!(windows) {
        format!("C:{}", posix.replace('/', "\\"))
    } else {
        posix.to_owned()
    }
}

fn list_of(roots: &[&str]) -> GrantList {
    let mut list = GrantList::default();
    // `record` puts the newest first, so feed oldest first to get `roots` order.
    for root in roots.iter().rev() {
        assert!(list.record(&abs(root)), "fixture {root} is absolute here");
    }
    list
}

#[test]
fn a_listed_root_and_everything_below_it_is_covered() {
    let list = list_of(&["/work/proj"]);
    assert!(list.covers(&abs("/work/proj")));
    assert!(list.covers(&abs("/work/proj/docs/deep")));
}

#[test]
fn a_sibling_sharing_a_name_prefix_is_not_covered() {
    // Component-wise, not string-prefix: `/work/proj-evil` starts with the
    // STRING `/work/proj` and is a different folder.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers(&abs("/work/proj-evil")));
    assert!(!list.covers(&abs("/work/pro")));
}

#[test]
fn an_ancestor_of_a_listed_root_is_not_covered() {
    // Granting `/work` because `/work/proj` was chosen would hand over every
    // sibling of the folder the user actually picked.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers(&abs("/work")));
    assert!(!list.covers(&abs("/")));
}

#[test]
fn an_empty_list_covers_nothing() {
    let list = GrantList::default();
    assert!(!list.covers(&abs("/")));
    assert!(!list.covers(&abs("/work/proj")));
}

#[test]
fn a_relative_candidate_is_never_covered() {
    // Relative names resolve against a working directory nothing here chose.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers("work/proj"));
    assert!(!list.covers(""));
}

#[test]
fn record_puts_the_newest_first_and_does_not_duplicate() {
    let mut list = GrantList::default();
    assert!(list.record(&abs("/a")));
    assert!(list.record(&abs("/b")));
    assert!(
        list.record(&abs("/a")),
        "re-choosing moves an entry to the front"
    );
    assert_eq!(list.roots(), [abs("/a"), abs("/b")]);
    assert!(
        !list.record(&abs("/a")),
        "already first: nothing changed, nothing to persist"
    );
}

#[test]
fn record_refuses_a_relative_or_empty_root() {
    let mut list = GrantList::default();
    assert!(!list.record("relative/dir"));
    assert!(!list.record(""));
    assert!(list.roots().is_empty());
}

#[test]
fn the_list_is_capped_and_drops_the_oldest() {
    let mut list = GrantList::default();
    for i in 0..(MAX_ROOTS + 5) {
        list.record(&abs(&format!("/r/{i}")));
    }
    assert_eq!(list.roots().len(), MAX_ROOTS);
    assert_eq!(
        list.roots()[0],
        abs(&format!("/r/{}", MAX_ROOTS + 4)),
        "newest kept"
    );
    assert!(!list.covers(&abs("/r/0")), "oldest evicted");
}

#[test]
fn bytes_round_trip() {
    let list = list_of(&["/a", "/b/c"]);
    let parsed = GrantList::parse(&list.to_bytes()).expect("own output parses");
    assert_eq!(parsed, list);
}

#[test]
fn parse_drops_entries_it_cannot_vouch_for() {
    let raw = serde_json::json!([
        FORMAT_MARKER,
        abs("/ok"),
        "relative",
        "",
        abs("/ok"),
        7,
        abs("/also")
    ])
    .to_string();
    let parsed = GrantList::parse(raw.as_bytes()).expect("valid envelope");
    assert_eq!(parsed.roots(), [abs("/ok"), abs("/also")]);
}

#[test]
fn parse_caps_an_oversized_file() {
    let roots: Vec<String> = (0..(MAX_ROOTS * 2))
        .map(|i| abs(&format!("/r/{i}")))
        .collect();
    let mut file = vec![serde_json::json!(FORMAT_MARKER)];
    file.extend(roots.into_iter().map(serde_json::Value::from));
    let raw = serde_json::Value::Array(file).to_string();
    let parsed = GrantList::parse(raw.as_bytes()).expect("valid envelope");
    assert_eq!(parsed.roots().len(), MAX_ROOTS);
    assert_eq!(parsed.roots()[0], abs("/r/0"), "file order is newest first");
}

#[test]
fn parse_refuses_what_it_cannot_interpret() {
    // Failing closed means NO grants: a list this build cannot read must not be
    // half-read into a list it then trusts.
    for raw in [
        &b"not json"[..],
        br#"["vmark-workspace-grants/2","/a"]"#,
        br#"["/a","/b"]"#,
        br#"[]"#,
        br#"{"version":1,"roots":["/a"]}"#,
        br#""vmark-workspace-grants/1""#,
    ] {
        assert!(
            GrantList::parse(raw).is_err(),
            "should refuse {:?}",
            String::from_utf8_lossy(raw)
        );
    }
}

/// The store plugin resolves a `load` file name against the app data directory
/// — `load("workspace-grants.json")` would land on this list. The webview is
/// no longer granted `load` (`app_plugins.rs`); this pins the second line of
/// defence should that grant return. The plugin can only ever write its cache,
/// a `HashMap<String, JsonValue>`, through `serde_json::to_vec_pretty`: a JSON
/// OBJECT. The list is a top-level ARRAY so that nothing the store can write
/// parses as one. This replays the plugin's own serializer with the payload a
/// script would want.
#[test]
fn nothing_the_store_plugin_can_write_parses_as_a_list() {
    let mut cache: std::collections::HashMap<String, serde_json::Value> = Default::default();
    cache.insert("version".into(), serde_json::json!(1));
    cache.insert("roots".into(), serde_json::json!(["/"]));
    cache.insert("0".into(), serde_json::json!(FORMAT_MARKER));
    let written = serde_json::to_vec_pretty(&cache).expect("the plugin's default_serialize");
    assert!(GrantList::parse(&written).is_err());
    let empty: std::collections::HashMap<String, serde_json::Value> = Default::default();
    assert!(GrantList::parse(&serde_json::to_vec_pretty(&empty).unwrap()).is_err());
}

#[test]
fn the_file_is_an_array_that_starts_with_the_marker() {
    let bytes = list_of(&["/a"]).to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(value, serde_json::json!([FORMAT_MARKER, abs("/a")]));
}

#[test]
fn absorb_keeps_this_session_first_and_the_file_behind_it() {
    // A Finder open can land before the file is loaded; loading must not drop it.
    let mut session = list_of(&["/new"]);
    session.absorb(list_of(&["/old", "/new"]));
    assert_eq!(session.roots(), [abs("/new"), abs("/old")]);
}

/// The byte limit is what bounds PARSING: `MAX_ROOTS` only caps what is kept,
/// after the whole array has been materialized. A file this build did not
/// write — padded, or simply huge — is refused before it is parsed.
#[test]
fn parse_refuses_a_file_over_the_byte_limit() {
    let limit = MAX_FILE_BYTES;
    let mut raw = serde_json::json!([FORMAT_MARKER, abs("/a")])
        .to_string()
        .into_bytes();
    // JSON whitespace: still a well-formed list, only larger.
    raw.resize(limit + 1, b' ');
    assert!(GrantList::parse(&raw).is_err(), "one byte over");
    raw.truncate(limit);
    assert!(
        GrantList::parse(&raw).is_ok(),
        "the limit itself is readable"
    );
}

// -- Windows spellings ---------------------------------------------------------
//
// Runtime grants matter MOST on Windows — the static scope stops at `F:\` — so
// the matching rules are pinned there with native fixtures: drive letters, UNC
// shares, and the extended-length prefix `canonical_dir` strips before a root is
// recorded.
#[cfg(windows)]
mod windows {
    use super::GrantList;

    fn list_of(roots: &[&str]) -> GrantList {
        let mut list = GrantList::default();
        for root in roots.iter().rev() {
            assert!(list.record(root), "{root} is absolute");
        }
        list
    }

    #[test]
    fn a_drive_root_covers_its_tree_and_not_its_neighbours() {
        let list = list_of(&[r"G:\work\proj"]);
        assert!(list.covers(r"G:\work\proj"));
        assert!(list.covers(r"G:\work\proj\docs"));
        assert!(
            !list.covers(r"G:\work\proj-evil"),
            "a sibling sharing a prefix"
        );
        assert!(!list.covers(r"G:\work"), "an ancestor");
        assert!(
            !list.covers(r"H:\work\proj"),
            "the same path on another drive"
        );
    }

    #[test]
    fn a_unc_root_covers_its_tree_and_not_its_share() {
        let list = list_of(&[r"\\server\share\proj"]);
        assert!(list.covers(r"\\server\share\proj\docs"));
        assert!(!list.covers(r"\\server\share"), "the share itself");
        assert!(!list.covers(r"\\server\share\proj-evil"));
        assert!(!list.covers(r"\\other\share\proj"), "another server");
    }

    /// Recorded roots are stripped of `\\?\` (`canonical_string`), and so is every
    /// candidate the command asks about. A verbatim spelling reaching `covers`
    /// is therefore not one this crate produced, and it is not waved through.
    #[test]
    fn a_verbatim_spelling_is_not_the_recorded_root() {
        let list = list_of(&[r"G:\work\proj"]);
        assert!(!list.covers(r"\\?\G:\work\proj\docs"));
    }

    #[test]
    fn a_drive_relative_path_is_never_absolute() {
        // `G:work` is relative to G:'s current directory, and `\work` to the
        // current drive: neither names one folder.
        let mut list = GrantList::default();
        assert!(!list.record(r"G:work"));
        assert!(!list.record(r"\work"));
        assert!(list.roots().is_empty());
    }
}

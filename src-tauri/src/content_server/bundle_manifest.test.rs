//! WI-FL0.8 — the static join between `resolve_cli`'s bundled-resource lookup
//! and the bundle manifest (`tauri.conf.json` → `bundle.resources`).
//!
//! Loaded via `#[path] mod bundle_manifest_test;` from `bundle_manifest.rs`, so
//! `super::BUNDLED_CLI_RESOURCE` IS the constant the runtime reads. The expected
//! path comes from the code, never from a copy kept here — a copy would let the
//! two drift and still report green.
//!
//! Why both halves are asserted: the v0.9.65 DMG shipped
//! `Contents/Resources/resources/` holding only `workflows/examples` while
//! `resolve_cli` looked for `content-server-dist/cli.js`, and nothing joined the
//! two. A glob alone lets a manifest entry point at a directory no build step
//! fills; an existence check alone lets a built artefact go unbundled. So the
//! constant may be `Some(rel)` only when an entry bundles `rel` AND the source
//! file exists on disk at test time — and while it is `None`, no stale entry may
//! mention the content server at all.

use super::BUNDLED_CLI_RESOURCE;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Substring no `bundle.resources` entry may carry while nothing ships the
/// content server. Broader than `content-server-dist` on purpose: a stale entry
/// under any spelling is the defect.
const STALE_MARKER: &str = "content-server";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn bundle_resources() -> Value {
    let path = manifest_dir().join("tauri.conf.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let conf: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
    conf.pointer("/bundle/resources")
        .cloned()
        .unwrap_or(Value::Null)
}

/// One `bundle.resources` entry, in either form Tauri accepts.
#[derive(Debug)]
enum ResourceEntry {
    /// `"resources/workflows/**/*"` — the source path is preserved in the bundle.
    Glob(String),
    /// `{ "src": "dest" }` — a file lands at `dest`, a directory's contents under `dest/`.
    Map { src: String, dest: String },
}

impl ResourceEntry {
    fn text(&self) -> String {
        match self {
            ResourceEntry::Glob(g) => g.clone(),
            ResourceEntry::Map { src, dest } => format!("{src} -> {dest}"),
        }
    }
}

fn entries(resources: &Value) -> Vec<ResourceEntry> {
    match resources {
        Value::Null => Vec::new(),
        Value::Array(items) => items
            .iter()
            .map(|v| {
                ResourceEntry::Glob(
                    v.as_str()
                        .unwrap_or_else(|| panic!("bundle.resources glob is not a string: {v}"))
                        .to_string(),
                )
            })
            .collect(),
        Value::Object(map) => map
            .iter()
            .map(|(src, dest)| ResourceEntry::Map {
                src: src.clone(),
                dest: dest
                    .as_str()
                    .unwrap_or_else(|| panic!("bundle.resources[{src}] is not a string: {dest}"))
                    .to_string(),
            })
            .collect(),
        other => panic!("unexpected bundle.resources shape: {other}"),
    }
}

fn segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect()
}

/// `*` within one segment; everything else literal.
fn segment_matches(pattern: &str, segment: &str) -> bool {
    let (p, s): (Vec<char>, Vec<char>) = (pattern.chars().collect(), segment.chars().collect());
    fn go(p: &[char], s: &[char]) -> bool {
        match (p.first(), s.first()) {
            (None, None) => true,
            (Some('*'), _) => go(&p[1..], s) || (!s.is_empty() && go(p, &s[1..])),
            (Some(pc), Some(sc)) if pc == sc => go(&p[1..], &s[1..]),
            _ => false,
        }
    }
    go(&p, &s)
}

/// Minimal glob over `/`-separated paths: `**` spans any number of segments
/// (including none), `*` matches within a segment. Enough for the manifest's
/// grammar; anything fancier should fail loudly here rather than pass by luck.
fn glob_matches(pattern: &str, path: &str) -> bool {
    fn go(p: &[&str], s: &[&str]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some(&"**") => go(&p[1..], s) || (!s.is_empty() && go(p, &s[1..])),
            Some(seg) => !s.is_empty() && segment_matches(seg, s[0]) && go(&p[1..], &s[1..]),
        }
    }
    go(&segments(pattern), &segments(path))
}

/// If `entry` would place a file at `rel` under the bundle's `Resources/`, the
/// source path (relative to `src-tauri/`) that file is copied from.
///
/// Glob form: `tauri_utils::resources::resource_relpath` keeps normal path
/// components verbatim, so `a/b/**/*` bundles `a/b/c.js` at `Resources/a/b/c.js`
/// — the source path IS the bundle path.
fn source_for(entry: &ResourceEntry, rel: &str) -> Option<PathBuf> {
    match entry {
        ResourceEntry::Glob(glob) => glob_matches(glob, rel).then(|| PathBuf::from(rel)),
        ResourceEntry::Map { src, dest } => {
            let dest = dest.trim_end_matches('/');
            if dest == rel {
                return Some(PathBuf::from(src));
            }
            let remainder = rel.strip_prefix(dest)?.strip_prefix('/')?;
            Some(Path::new(src.trim_end_matches('/')).join(remainder))
        }
    }
}

#[test]
fn bundled_cli_resource_is_joined_to_the_manifest() {
    let resources = bundle_resources();
    assert_ne!(
        resources,
        Value::Null,
        "tauri.conf.json has no bundle.resources — this join would be reading nothing"
    );
    let entries = entries(&resources);

    match BUNDLED_CLI_RESOURCE {
        Some(rel) => {
            let sources: Vec<PathBuf> = entries.iter().filter_map(|e| source_for(e, rel)).collect();
            assert!(
                !sources.is_empty(),
                "BUNDLED_CLI_RESOURCE is Some({rel:?}) but no bundle.resources entry bundles it: {:?}",
                entries.iter().map(ResourceEntry::text).collect::<Vec<_>>()
            );
            let on_disk: Vec<PathBuf> = sources
                .iter()
                .map(|s| manifest_dir().join(s))
                .filter(|p| p.is_file())
                .collect();
            assert!(
                !on_disk.is_empty(),
                "BUNDLED_CLI_RESOURCE is Some({rel:?}) and the manifest bundles it, but no source \
                 file exists for it (looked at {:?}). The constant may only flip together with the \
                 build step that produces the artefact — otherwise the bundle ships an empty promise.",
                sources.iter().map(|s| manifest_dir().join(s)).collect::<Vec<_>>()
            );
        }
        None => {
            for entry in &entries {
                let text = entry.text();
                assert!(
                    !text.contains(STALE_MARKER),
                    "bundle.resources entry {text:?} mentions {STALE_MARKER:?} while \
                     BUNDLED_CLI_RESOURCE is None — either flip the constant with a real build step, \
                     or remove the stale entry"
                );
            }
        }
    }
}

#[test]
fn glob_double_star_spans_any_depth_including_none() {
    assert!(glob_matches(
        "resources/workflows/**/*",
        "resources/workflows/examples/a.yml"
    ));
    assert!(glob_matches(
        "resources/workflows/**/*",
        "resources/workflows/a.yml"
    ));
    assert!(glob_matches("**/cli.js", "content-server-dist/cli.js"));
    assert!(glob_matches("**/cli.js", "cli.js"));
    assert!(!glob_matches(
        "resources/workflows/**/*",
        "resources/other/a.yml"
    ));
    assert!(!glob_matches(
        "resources/workflows/**/*",
        "resources/workflows"
    ));
}

#[test]
fn glob_single_star_stays_within_one_segment() {
    assert!(glob_matches("dist/*.js", "dist/cli.js"));
    assert!(glob_matches("dist/cli*", "dist/cli.js"));
    assert!(!glob_matches("dist/*.js", "dist/sub/cli.js"));
    assert!(!glob_matches("dist/*.js", "dist/cli.mjs"));
    assert!(glob_matches("a/b/c", "a/b/c"));
    assert!(!glob_matches("a/b/c", "a/b/d"));
}

#[test]
fn glob_form_source_is_the_bundle_path_itself() {
    let entry = ResourceEntry::Glob("content-server-dist/**/*".into());
    assert_eq!(
        source_for(&entry, "content-server-dist/cli.js"),
        Some(PathBuf::from("content-server-dist/cli.js"))
    );
    assert_eq!(
        source_for(&entry, "resources/content-server-dist/cli.js"),
        None
    );
}

#[test]
fn map_form_resolves_file_and_directory_targets() {
    let file = ResourceEntry::Map {
        src: "../server/content/dist/cli.js".into(),
        dest: "content-server-dist/cli.js".into(),
    };
    assert_eq!(
        source_for(&file, "content-server-dist/cli.js"),
        Some(PathBuf::from("../server/content/dist/cli.js"))
    );
    let dir = ResourceEntry::Map {
        src: "../server/content/dist/".into(),
        dest: "content-server-dist/".into(),
    };
    assert_eq!(
        source_for(&dir, "content-server-dist/cli.js"),
        Some(PathBuf::from("../server/content/dist/cli.js"))
    );
    assert_eq!(source_for(&dir, "content-server-distX/cli.js"), None);
    assert_eq!(source_for(&dir, "other/cli.js"), None);
}

#[test]
fn entries_accept_both_manifest_forms() {
    let array = serde_json::json!(["a/**/*", "b/c.js"]);
    assert_eq!(entries(&array).len(), 2);
    let map = serde_json::json!({ "../x/": "y/" });
    let parsed = entries(&map);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].text(), "../x/ -> y/");
    assert!(entries(&Value::Null).is_empty());
}

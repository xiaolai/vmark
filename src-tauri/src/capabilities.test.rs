//! Capability-file contract (#1202).
//!
//! Tauri capability files are per-WINDOW. A permission granted in
//! `default.json` covers `main` and `doc-*` and reaches the Settings window not
//! at all — which is how the CC-Switch import button shipped dead: the
//! `ccswitch://*` opener scope was declared in `default.json` while the button
//! that uses it lives in the Settings window, so every click raised
//! "Not allowed to open url ccswitch://…" on every platform.
//!
//! Nothing pinned that pairing, so these tests read the shipped JSON and assert
//! the scope sits in the capability of the window that actually needs it.
//!
//! WI-LX1.3 — every capability file's fs scope is pinned exactly (the
//! PDF-export window lost a `$HOME/**` write grant it never used), and
//! WI-LX1.2 — the asset-protocol scope is pinned to the same static roots.

use serde_json::Value;

const DEFAULT_CAPABILITY: &str = include_str!("../capabilities/default.json");
const SETTINGS_CAPABILITY: &str = include_str!("../capabilities/settings.json");

fn parse(raw: &str) -> Value {
    serde_json::from_str(raw).expect("capability file is valid JSON")
}

/// Window-label globs the capability applies to.
fn windows(capability: &Value) -> Vec<String> {
    capability["windows"]
        .as_array()
        .expect("capability declares windows")
        .iter()
        .map(|w| w.as_str().expect("window label is a string").to_string())
        .collect()
}

/// Every URL string allowed by a scoped `opener:allow-open-url` entry.
fn allowed_open_urls(capability: &Value) -> Vec<String> {
    capability["permissions"]
        .as_array()
        .expect("capability declares permissions")
        .iter()
        .filter(|p| p["identifier"] == "opener:allow-open-url")
        .flat_map(|p| {
            p["allow"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
        })
        .filter_map(|entry| entry["url"].as_str().map(str::to_owned))
        .collect()
}

#[test]
fn the_settings_window_may_open_ccswitch_links() {
    // The CC-Switch import row renders in `src/pages/settings/` — the Settings
    // window — so this is the capability that has to carry the scheme.
    let settings = parse(SETTINGS_CAPABILITY);
    assert!(
        windows(&settings).iter().any(|w| w == "settings"),
        "settings.json must govern the settings window"
    );
    assert!(
        allowed_open_urls(&settings)
            .iter()
            .any(|u| u.starts_with("ccswitch://")),
        "the settings window needs an opener scope for ccswitch:// — \
         `opener:default` allows only mailto:, tel:, http:// and https://, so \
         without this the import button fails with 'Not allowed to open url'"
    );
}

#[test]
fn the_document_capability_keeps_its_ccswitch_scope() {
    // Document windows also surface the link (Settings can be opened from
    // either surface in future); losing it here would be a silent regression of
    // the same class, so pin both rather than moving the grant around.
    let default = parse(DEFAULT_CAPABILITY);
    assert!(
        allowed_open_urls(&default)
            .iter()
            .any(|u| u.starts_with("ccswitch://")),
        "default.json lost its ccswitch:// opener scope"
    );
}

#[test]
fn capability_windows_do_not_overlap_between_default_and_settings() {
    // The bug was a grant landing in a capability whose windows exclude the
    // caller. That is only diagnosable if the split stays disjoint — if
    // `default.json` ever also matched "settings", a missing settings grant
    // would be masked and the next such bug would be invisible again.
    let default_windows = windows(&parse(DEFAULT_CAPABILITY));
    assert!(
        !default_windows.iter().any(|w| w == "settings" || w == "*"),
        "default.json must not cover the settings window: {default_windows:?}"
    );
}

// -- The filesystem scopes, per capability file (ledger findings, WI-LX1.3) --
//
// The fs permissions are the widest thing a webview holds, and nothing pinned
// them: `pdf-export.json` carried a `$HOME/**` + `/Volumes/**` WRITE grant
// under a description that said "read-only", and nobody could say whether the
// window still needed it. Each file's fs surface is now stated here exactly —
// adding a permission, a path, or a window means changing this test.

use std::collections::{BTreeMap, BTreeSet};

const WINDOWS_CAPABILITY: &str = include_str!("../capabilities/windows.json");
const PDF_EXPORT_CAPABILITY: &str = include_str!("../capabilities/pdf-export.json");

/// Where document windows may reach without a runtime grant.
const STATIC_ROOTS: [&str; 4] = ["$HOME/**", "/Volumes/**", "/mnt/**", "/media/**"];
/// The drive letters `windows.json` adds on Windows. G: and later, and network
/// shares, are reached only through a runtime grant (`fs_scope.rs`).
const WINDOWS_DRIVES: [&str; 4] = ["C:\\**", "D:\\**", "E:\\**", "F:\\**"];
/// Every fs command a document window may call — exactly the commands the
/// frontend imports from `@tauri-apps/plugin-fs`, which
/// `scripts/check-fs-capability-grants.test.mjs` derives from `src/` (#1555).
const DOCUMENT_FS_PERMISSIONS: [&str; 12] = [
    "fs:allow-copy-file",
    "fs:allow-exists",
    "fs:allow-lstat",
    "fs:allow-mkdir",
    "fs:allow-read-dir",
    "fs:allow-read-file",
    "fs:allow-read-text-file",
    "fs:allow-remove",
    "fs:allow-rename",
    "fs:allow-stat",
    "fs:allow-write-file",
    "fs:allow-write-text-file",
];

/// A permission's identifier, whether it is a bare string or a scoped object.
fn identifier(permission: &Value) -> &str {
    permission
        .as_str()
        .or_else(|| permission["identifier"].as_str())
        .expect("a permission is a string or has an identifier")
}

fn identifiers(capability: &Value) -> Vec<&str> {
    capability["permissions"]
        .as_array()
        .expect("capability declares permissions")
        .iter()
        .map(identifier)
        .collect()
}

/// `fs:*` identifier → the paths it allows, sorted. A bare-string fs
/// permission maps to an empty list, which no assertion below accepts.
fn fs_scopes(capability: &Value) -> BTreeMap<String, Vec<String>> {
    capability["permissions"]
        .as_array()
        .expect("capability declares permissions")
        .iter()
        .filter(|p| identifier(p).starts_with("fs:"))
        .map(|p| {
            let mut paths: Vec<String> = p["allow"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|entry| {
                    entry["path"]
                        .as_str()
                        .expect("fs scope entry has a path")
                        .to_owned()
                })
                .collect();
            paths.sort();
            (identifier(p).to_owned(), paths)
        })
        .collect()
}

fn sorted(paths: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = paths.iter().map(|p| (*p).to_owned()).collect();
    out.sort();
    out
}

#[test]
fn document_windows_reach_exactly_the_static_roots() {
    let scopes = fs_scopes(&parse(DEFAULT_CAPABILITY));
    let names: BTreeSet<&str> = scopes.keys().map(String::as_str).collect();
    assert_eq!(names, DOCUMENT_FS_PERMISSIONS.into_iter().collect());
    for (permission, paths) in &scopes {
        assert_eq!(paths, &sorted(&STATIC_ROOTS), "{permission}");
    }
}

#[test]
fn windows_drive_letters_are_windows_only_and_stop_at_f() {
    let windows = parse(WINDOWS_CAPABILITY);
    assert_eq!(windows["platforms"], serde_json::json!(["windows"]));
    assert_eq!(windows["windows"], serde_json::json!(["main", "doc-*"]));
    let scopes = fs_scopes(&windows);
    let names: BTreeSet<&str> = scopes.keys().map(String::as_str).collect();
    assert_eq!(names, DOCUMENT_FS_PERMISSIONS.into_iter().collect());
    for (permission, paths) in &scopes {
        assert_eq!(paths, &sorted(&WINDOWS_DRIVES), "{permission}");
    }
}

#[test]
fn the_pdf_export_window_reads_app_temp_and_writes_nothing() {
    // It reads the HTML the document window rendered into `$APPDATA/temp`. The
    // PDF itself is written by the Rust `export_pdf` command, so the window
    // needs no fs write permission at all.
    let pdf = parse(PDF_EXPORT_CAPABILITY);
    assert_eq!(pdf["windows"], serde_json::json!(["pdf-export"]));
    let expected: BTreeMap<String, Vec<String>> = [
        (
            "fs:allow-read-file".to_owned(),
            vec!["$APPDATA/temp/**".to_owned()],
        ),
        (
            "fs:allow-read-text-file".to_owned(),
            vec!["$APPDATA/temp/**".to_owned()],
        ),
    ]
    .into();
    assert_eq!(fs_scopes(&pdf), expected);
}

#[test]
fn the_settings_window_has_no_filesystem_or_shell_permission() {
    let settings = parse(SETTINGS_CAPABILITY);
    let reach: Vec<&str> = identifiers(&settings)
        .into_iter()
        .filter(|id| id.starts_with("fs:") || id.starts_with("shell:"))
        .collect();
    assert!(reach.is_empty(), "settings.json grants {reach:?}");
}

// -- The asset protocol, narrowed to the same roots (WI-LX1.2) ---------------
//
// It was `**/*`, which matches every absolute path without a dot component —
// so the per-file asset grants in `asset_access.rs` guarded nothing. It is now
// the fs static roots, extended at runtime by the same grants that extend the
// fs scope (`fs_scope.rs`, `asset_access.rs`, `workspace::grants`).

const TAURI_CONF: &str = include_str!("../tauri.conf.json");
const TAURI_WINDOWS_CONF: &str = include_str!("../tauri.windows.conf.json");

fn asset_scope(conf: &Value) -> Vec<String> {
    let mut scope: Vec<String> = conf["app"]["security"]["assetProtocol"]["scope"]
        .as_array()
        .expect("assetProtocol.scope is a list")
        .iter()
        .map(|p| p.as_str().expect("scope entry is a path").to_owned())
        .collect();
    scope.sort();
    scope
}

/// The paths `fs:allow-read-file` grants in a capability — what a document
/// window can read without a runtime grant.
fn read_roots(capability: &Value) -> Vec<String> {
    fs_scopes(capability)
        .remove("fs:allow-read-file")
        .expect("the capability reads files")
}

#[test]
fn the_asset_protocol_reaches_what_document_windows_can_read() {
    let conf = parse(TAURI_CONF);
    assert_eq!(conf["app"]["security"]["assetProtocol"]["enable"], true);
    assert_eq!(asset_scope(&conf), read_roots(&parse(DEFAULT_CAPABILITY)));
}

#[test]
fn on_windows_the_asset_protocol_also_reaches_c_to_f() {
    // Tauri merges `tauri.windows.conf.json` over the base with RFC 7396, which
    // REPLACES arrays — so the Windows list must restate the base roots too.
    let windows_conf = parse(TAURI_WINDOWS_CONF);
    let mut expected = read_roots(&parse(DEFAULT_CAPABILITY));
    expected.extend(read_roots(&parse(WINDOWS_CAPABILITY)));
    expected.sort();
    assert_eq!(asset_scope(&windows_conf), expected);
    // It overrides the asset scope and nothing else.
    assert_eq!(
        windows_conf,
        serde_json::json!({ "app": { "security": { "assetProtocol": {
            "scope": windows_conf["app"]["security"]["assetProtocol"]["scope"].clone()
        } } } }),
        "tauri.windows.conf.json must not override anything but the asset scope"
    );
}

#[test]
fn the_asset_protocol_has_no_catch_all_entry() {
    for conf in [parse(TAURI_CONF), parse(TAURI_WINDOWS_CONF)] {
        for entry in asset_scope(&conf) {
            let root = entry.trim_end_matches(['*', '/', '\\']);
            assert!(!root.is_empty(), "{entry:?} reaches every path");
        }
    }
}

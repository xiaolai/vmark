//! WI-S0.5 — the "new-browser-tab" item is NATIVE, not a DOM shortcut: once the
//! embedded browser's WKWebView is first responder it eats key events, so React never
//! sees them. AppKit dispatches menu accelerators regardless of focus. The contract
//! table below is what keeps its accelerator in step with shortcuts.ts + the docs.
//! Executable contract tests for the localized menu tree.
//!
//! Two contracts are pinned here without needing a Tauri `AppHandle`:
//!
//! 1. **Default accelerators** — every `accel("id", "default")` call site in
//!    the section builders must match `DEFAULT_ACCELERATORS` /
//!    `PLATFORM_ACCELERATORS` below, and vice versa (bijective). These
//!    defaults must stay in sync with
//!    `src/stores/settingsStore/shortcuts.ts` and
//!    `website/guide/shortcuts.md` (see `.claude/rules/41-keyboard-shortcuts.md`).
//! 2. **Locale keys** — every `t!("menu.…")` key used by the menu sources
//!    must exist in `locales/en.yml`, so a renamed/missing key fails in CI
//!    instead of rendering a missing-key placeholder in the menu bar.
//!
//! The scan parses the raw section sources (whitespace-insensitive), so
//! rustfmt reflowing never breaks it. Menu IDs themselves are additionally
//! pinned end-to-end by `src/shared/menu-ids.json` (frontend contract test).

/// All per-section builder sources of the localized menu.
const MENU_SOURCES: &[(&str, &str)] = &[
    ("app_menu.rs", include_str!("localized/app_menu.rs")),
    ("edit_menu.rs", include_str!("localized/edit_menu.rs")),
    ("export_menu.rs", include_str!("localized/export_menu.rs")),
    ("file_menu.rs", include_str!("localized/file_menu.rs")),
    (
        "file_submenus.rs",
        include_str!("localized/file_submenus.rs"),
    ),
    ("format_menu.rs", include_str!("localized/format_menu.rs")),
    (
        "format_submenus.rs",
        include_str!("localized/format_submenus.rs"),
    ),
    ("insert_menu.rs", include_str!("localized/insert_menu.rs")),
    (
        "insert_submenus.rs",
        include_str!("localized/insert_submenus.rs"),
    ),
    ("view_menu.rs", include_str!("localized/view_menu.rs")),
    (
        "window_help_menu.rs",
        include_str!("localized/window_help_menu.rs"),
    ),
];

/// Default accelerator per menu id (platform-independent entries).
/// Empty string = deliberately unbound by default.
const DEFAULT_ACCELERATORS: &[(&str, &str)] = &[
    ("audio", ""),
    ("bold", "CmdOrCtrl+B"),
    ("bookmark", "Alt+CmdOrCtrl+B"),
    ("check-markdown", "Alt+CmdOrCtrl+V"),
    ("clear-format", "CmdOrCtrl+\\"),
    ("close", "CmdOrCtrl+W"),
    ("code", "CmdOrCtrl+Shift+`"),
    ("code-fences", "Alt+CmdOrCtrl+C"),
    ("collapsible-block", "Alt+CmdOrCtrl+D"),
    ("copy-html", "CmdOrCtrl+Shift+C"),
    ("decrease-heading", "CmdOrCtrl+Alt+["),
    ("delete-line", "CmdOrCtrl+Shift+K"),
    ("diagram", "Alt+CmdOrCtrl+Shift+D"),
    ("diagram-preview", "Alt+CmdOrCtrl+P"),
    ("duplicate-line", "Shift+Alt+Down"),
    ("expand-selection", "Ctrl+Shift+Up"),
    ("export-html", ""),
    ("export-pandoc-docx", ""),
    ("export-pandoc-epub", ""),
    ("export-pandoc-latex", ""),
    ("export-pandoc-odt", ""),
    ("export-pandoc-rtf", ""),
    ("export-pandoc-txt", ""),
    ("export-pdf", "CmdOrCtrl+P"),
    ("export-pdf-native", ""),
    ("file-explorer", "Ctrl+Shift+2"),
    ("find-in-files", "CmdOrCtrl+Shift+H"),
    ("find-next", "CmdOrCtrl+G"),
    ("find-prev", "CmdOrCtrl+Shift+G"),
    ("find-replace", "CmdOrCtrl+F"),
    ("fit-tables", ""),
    ("focus-mode", "F8"),
    ("format-cjk", "CmdOrCtrl+Shift+F"),
    ("format-cjk-file", "Alt+CmdOrCtrl+Shift+F"),
    ("format-table", "Alt+CmdOrCtrl+T"),
    ("graphviz-diagram", ""),
    ("heading-1", "CmdOrCtrl+1"),
    ("heading-2", "CmdOrCtrl+2"),
    ("heading-3", "CmdOrCtrl+3"),
    ("heading-4", "CmdOrCtrl+4"),
    ("heading-5", "CmdOrCtrl+5"),
    ("heading-6", "CmdOrCtrl+6"),
    ("highlight", "CmdOrCtrl+Shift+M"),
    ("horizontal-line", "Alt+CmdOrCtrl+-"),
    ("image", "Shift+CmdOrCtrl+I"),
    ("increase-heading", "CmdOrCtrl+Alt+]"),
    ("indent", "CmdOrCtrl+]"),
    ("info-caution", "CmdOrCtrl+Shift+U"),
    ("info-important", "CmdOrCtrl+Alt+Shift+I"),
    ("info-note", "Alt+CmdOrCtrl+N"),
    ("info-tip", "CmdOrCtrl+Alt+Shift+T"),
    ("info-warning", "CmdOrCtrl+Shift+W"),
    ("insert-table", "CmdOrCtrl+Shift+T"),
    ("italic", "CmdOrCtrl+I"),
    ("join-lines", "CmdOrCtrl+J"),
    ("knowledge-base", "Ctrl+Shift+4"),
    ("line-numbers", "Alt+CmdOrCtrl+L"),
    ("link", "CmdOrCtrl+K"),
    ("lint-next", "F2"),
    ("lint-prev", "Shift+F2"),
    ("markdown-split", "Shift+F6"),
    ("math-block", "Alt+CmdOrCtrl+Shift+M"),
    ("mindmap", "Alt+CmdOrCtrl+Shift+K"),
    ("move-line-down", "Alt+Down"),
    ("move-line-up", "Alt+Up"),
    ("move-to", ""),
    ("new", "CmdOrCtrl+N"),
    ("new-window", "CmdOrCtrl+Shift+N"),
    ("new-browser-tab", "Alt+CmdOrCtrl+Shift+B"),
    ("open", ""),
    ("open-folder", "CmdOrCtrl+Shift+O"),
    ("ordered-list", "Alt+CmdOrCtrl+O"),
    ("outdent", "CmdOrCtrl+["),
    ("outline", "Ctrl+Shift+1"),
    ("paragraph", "CmdOrCtrl+Shift+0"),
    ("preferences", "CmdOrCtrl+,"),
    ("quick-open", "CmdOrCtrl+O"),
    ("quit", "CmdOrCtrl+Q"),
    ("quote", "Alt+CmdOrCtrl+Q"),
    ("read-only", "F10"),
    ("redo", "CmdOrCtrl+Shift+Z"),
    ("remove-blank-lines", ""),
    ("save", "CmdOrCtrl+S"),
    ("save-all-quit", "Alt+CmdOrCtrl+Shift+Q"),
    ("save-as", "CmdOrCtrl+Shift+S"),
    ("select-line", "CmdOrCtrl+L"),
    ("show-invisibles", "F3"),
    ("sort-lines-asc", "F4"),
    ("sort-lines-desc", "Shift+F4"),
    ("source-mode", "F6"),
    ("strikethrough", "CmdOrCtrl+Shift+X"),
    ("subscript", "Alt+CmdOrCtrl+="),
    ("superscript", "Alt+CmdOrCtrl+Shift+="),
    ("task-list", "Alt+CmdOrCtrl+X"),
    ("toggle-quote-style", "Shift+CmdOrCtrl+'"),
    ("toggle-terminal", "Ctrl+`"),
    ("transform-toggle-case", ""),
    ("typewriter-mode", "F9"),
    ("underline", "CmdOrCtrl+U"),
    ("undo", "CmdOrCtrl+Z"),
    ("unordered-list", "Alt+CmdOrCtrl+U"),
    ("use-selection-find", "CmdOrCtrl+E"),
    ("video", ""),
    ("view-history", "Ctrl+Shift+3"),
    ("wiki-link", "Alt+CmdOrCtrl+K"),
    ("word-wrap", "Alt+Z"),
    ("wysiwyg-mode", ""),
    ("zoom-actual", "CmdOrCtrl+0"),
    ("zoom-in", "CmdOrCtrl+="),
    ("zoom-out", "CmdOrCtrl+-"),
];

/// Platform-conditional defaults: `(id, macOS default, other default)`.
const PLATFORM_ACCELERATORS: &[(&str, &str, &str)] = &[
    ("transform-lowercase", "Ctrl+Shift+L", "Alt+Shift+L"),
    ("transform-title-case", "Ctrl+Shift+T", "Alt+Shift+T"),
    ("transform-uppercase", "Ctrl+Shift+U", "Alt+Shift+U"),
];

/// A default accelerator as written at an `accel(…)` call site.
#[derive(Debug, PartialEq, Eq)]
enum ScannedDefault {
    Literal(String),
    /// `if cfg!(target_os = "macos") { mac } else { other }`
    MacosElse(String, String),
}

/// Read a Rust string literal starting at `bytes[i]` (which must be `"`).
/// Returns the unescaped content and the index just past the closing quote.
fn read_string(bytes: &[u8], mut i: usize) -> (String, usize) {
    assert_eq!(bytes[i], b'"');
    i += 1;
    let mut out = String::new();
    while bytes[i] != b'"' {
        if bytes[i] == b'\\' {
            i += 1;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    (out, i + 1)
}

/// Collect every string literal inside one `accel(…)` argument list,
/// tracking paren depth so nested `cfg!(…)` parens don't end the scan early.
fn scan_accel_calls(source: &str) -> Vec<(String, ScannedDefault)> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(pos) = source[i..].find("accel(") {
        let mut j = i + pos + "accel(".len();
        let mut depth = 1usize;
        let mut literals: Vec<String> = Vec::new();
        while depth > 0 {
            match bytes[j] {
                b'(' => {
                    depth += 1;
                    j += 1;
                }
                b')' => {
                    depth -= 1;
                    j += 1;
                }
                b'"' => {
                    let (lit, next) = read_string(bytes, j);
                    literals.push(lit);
                    j = next;
                }
                _ => j += 1,
            }
        }
        let scanned = match literals.len() {
            2 => ScannedDefault::Literal(literals[1].clone()),
            4 => {
                assert_eq!(literals[1], "macos", "unexpected cfg! target in accel call");
                ScannedDefault::MacosElse(literals[2].clone(), literals[3].clone())
            }
            n => panic!("unexpected accel(…) shape with {n} string literals: {literals:?}"),
        };
        out.push((literals[0].clone(), scanned));
        i = j;
    }
    out
}

#[test]
fn every_accel_call_site_matches_the_contract_table() {
    for (file, source) in MENU_SOURCES {
        for (id, scanned) in scan_accel_calls(source) {
            let expected = DEFAULT_ACCELERATORS
                .iter()
                .find(|(tid, _)| *tid == id)
                .map(|(_, accel)| ScannedDefault::Literal((*accel).to_string()))
                .or_else(|| {
                    PLATFORM_ACCELERATORS
                        .iter()
                        .find(|(tid, _, _)| *tid == id)
                        .map(|(_, mac, other)| {
                            ScannedDefault::MacosElse((*mac).to_string(), (*other).to_string())
                        })
                });
            match expected {
                None => panic!(
                    "{file}: accel(\"{id}\", …) is not in the contract table — \
                     add it here and sync shortcuts.ts + website docs"
                ),
                Some(expected) => assert_eq!(
                    scanned, expected,
                    "{file}: default accelerator for `{id}` drifted from the contract table"
                ),
            }
        }
    }
}

#[test]
fn every_contract_entry_has_a_call_site() {
    let scanned: Vec<(String, ScannedDefault)> = MENU_SOURCES
        .iter()
        .flat_map(|(_, source)| scan_accel_calls(source))
        .collect();
    for (id, _) in DEFAULT_ACCELERATORS {
        assert!(
            scanned.iter().any(|(sid, _)| sid.as_str() == *id),
            "contract table lists `{id}` but no accel(\"{id}\", …) call site exists"
        );
    }
    for (id, _, _) in PLATFORM_ACCELERATORS {
        assert!(
            scanned.iter().any(|(sid, _)| sid.as_str() == *id),
            "contract table lists `{id}` but no accel(\"{id}\", …) call site exists"
        );
    }
}

#[test]
fn duplicate_ids_across_platform_branches_agree_on_their_default() {
    // e.g. `preferences`, `quit`, `save-all-quit` appear in both the macOS
    // App menu and the non-macOS File menu tail — their defaults must match.
    let mut seen: Vec<(String, ScannedDefault)> = Vec::new();
    for (file, source) in MENU_SOURCES {
        for (id, scanned) in scan_accel_calls(source) {
            if let Some((_, first)) = seen.iter().find(|(sid, _)| *sid == id) {
                assert_eq!(
                    &scanned, first,
                    "{file}: `{id}` declares a different default than another branch"
                );
            } else {
                seen.push((id, scanned));
            }
        }
    }
}

#[test]
fn every_menu_locale_key_exists_in_english_yaml() {
    let en_yaml = include_str!("../../locales/en.yml");
    for (file, source) in MENU_SOURCES {
        let bytes = source.as_bytes();
        let mut i = 0;
        while let Some(pos) = source[i..].find("t!(\"") {
            let start = i + pos + "t!(".len();
            let (key, next) = read_string(bytes, start);
            i = next;
            let suffix = key
                .strip_prefix("menu.")
                .unwrap_or_else(|| panic!("{file}: locale key `{key}` outside menu.* namespace"));
            let needle = format!("{suffix}:");
            assert!(
                en_yaml
                    .lines()
                    .any(|line| line.trim_start().starts_with(&needle)),
                "{file}: locale key `{key}` missing from locales/en.yml"
            );
        }
    }
}

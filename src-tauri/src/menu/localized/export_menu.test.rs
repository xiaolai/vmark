//! Tests for `export_menu.rs` — Pandoc menu-ID contract and locale-key
//! coverage, driven by the `PANDOC_FORMATS` / `PANDOC_HINT` tables in the
//! source file (single source of truth; included via `#[path]`).
//!
//! The frontend listens on `menu:{id}` in `src/hooks/useExportMenuEvents.ts`.

use super::{PANDOC_FORMATS, PANDOC_HINT};

fn all_pandoc_entries() -> Vec<(&'static str, &'static str)> {
    let mut entries = PANDOC_FORMATS.to_vec();
    entries.push(PANDOC_HINT);
    entries
}

/// Catches typos in locale keys used by the Pandoc submenu.
#[test]
fn pandoc_locale_keys_exist_in_english_yaml() {
    let en_yaml = include_str!("../../../locales/en.yml");
    for (_, locale_key) in all_pandoc_entries() {
        let key = locale_key
            .strip_prefix("menu.")
            .expect("pandoc locale keys live under the `menu:` yml section");
        assert!(
            en_yaml.contains(&format!("{key}:")),
            "missing locale key in en.yml: `{key}`"
        );
    }
}

/// Catches drift between the table and the literal call sites: every menu ID
/// and locale key must appear verbatim in `export_menu.rs`, because the
/// menu-ID extraction contract scans for literal `with_id(app, "…")` text.
#[test]
fn pandoc_table_rows_appear_verbatim_at_the_call_sites() {
    let source = include_str!("export_menu.rs");
    // Only inspect the code below the table itself, so the table entries
    // can't satisfy their own assertion.
    let call_sites = source
        .split_once("pub(super) fn build")
        .expect("export_menu.rs defines build()")
        .1;
    for (id, locale_key) in all_pandoc_entries() {
        assert!(
            call_sites.contains(&format!("\"{id}\"")),
            "menu ID `{id}` not found at a call site in export_menu.rs — \
             frontend listener at useExportMenuEvents.ts will break"
        );
        assert!(
            call_sites.contains(&format!("t!(\"{locale_key}\")")),
            "locale key `{locale_key}` not found at a call site in export_menu.rs"
        );
    }
}

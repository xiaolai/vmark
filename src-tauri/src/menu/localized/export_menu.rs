//! Export submenu for the File menu (HTML, PDF, Pandoc formats, Copy HTML).
//!
//! Purpose: Builds the Export submenu for `create_localized_menu`. Extracted
//! verbatim from `localized.rs` to keep that file under the size gate. The
//! Pandoc submenu branches on Pandoc availability: 6 format items when
//! installed, 1 install-CTA item otherwise. A `#[cfg(test)]` module guards
//! the Pandoc menu-ID contract and locale-key coverage.
//!
//! @coordinates-with `src/hooks/useExportMenuEvents.ts` (consumes `menu:export-pandoc-*` events)
//! @coordinates-with `src/pages/settings/FilesImagesSettings.tsx` (triggers menu rebuild on Pandoc detect)

use rust_i18n::t;
use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};

use super::AccelFn;

/// Pandoc export formats: `(menu ID, locale key)`. Single source of truth
/// for the Pandoc submenu contract — `export_menu.test.rs` asserts that
/// every row appears verbatim at the `MenuItem::with_id` call sites below
/// and that every locale key exists in `en.yml`.
///
/// The call sites keep literal IDs instead of looping over this table
/// because the menu-ID extraction contract
/// (`src/shared/menuIdExtraction.ts`, consumed by
/// `scripts/extract-menu-ids.ts`) textually scans the Rust menu sources for
/// `with_id` calls whose ID argument is a string literal; IDs produced
/// through a variable would silently vanish from `menu-ids.json`.
#[cfg(test)]
pub(super) const PANDOC_FORMATS: &[(&str, &str)] = &[
    ("export-pandoc-docx", "menu.file.export.pandocDocx"),
    ("export-pandoc-epub", "menu.file.export.pandocEpub"),
    ("export-pandoc-latex", "menu.file.export.pandocLatex"),
    ("export-pandoc-odt", "menu.file.export.pandocOdt"),
    ("export-pandoc-rtf", "menu.file.export.pandocRtf"),
    ("export-pandoc-txt", "menu.file.export.pandocTxt"),
];

/// Menu ID and locale key for the install-CTA item shown when Pandoc is absent.
#[cfg(test)]
pub(super) const PANDOC_HINT: (&str, &str) = ("export-pandoc-hint", "menu.file.export.pandocHint");

/// Build the Export submenu with platform-aware item set. `export-pdf-native`
/// is the native PDF export path backed by WKWebView + NSPrintOperation;
/// the entire `pdf_export` Rust module is `#[cfg(target_os = "macos")]`
/// and the corresponding Tauri command is not registered on Windows/Linux,
/// so the menu item must be hidden there. Issue #929 reported the menu
/// leaking through and showing a "macOS only" toast — fixed by omitting
/// the item from the submenu entirely on non-macOS.
pub(super) fn build(app: &tauri::AppHandle, accel: &AccelFn) -> tauri::Result<Submenu<tauri::Wry>> {
    let other_formats_submenu = {
        let items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> =
            if crate::pandoc::commands::resolve_pandoc_path().is_some() {
                vec![
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-docx",
                        &t!("menu.file.export.pandocDocx"),
                        true,
                        accel("export-pandoc-docx", ""),
                    )?),
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-epub",
                        &t!("menu.file.export.pandocEpub"),
                        true,
                        accel("export-pandoc-epub", ""),
                    )?),
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-latex",
                        &t!("menu.file.export.pandocLatex"),
                        true,
                        accel("export-pandoc-latex", ""),
                    )?),
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-odt",
                        &t!("menu.file.export.pandocOdt"),
                        true,
                        accel("export-pandoc-odt", ""),
                    )?),
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-rtf",
                        &t!("menu.file.export.pandocRtf"),
                        true,
                        accel("export-pandoc-rtf", ""),
                    )?),
                    Box::new(MenuItem::with_id(
                        app,
                        "export-pandoc-txt",
                        &t!("menu.file.export.pandocTxt"),
                        true,
                        accel("export-pandoc-txt", ""),
                    )?),
                ]
            } else {
                vec![Box::new(MenuItem::with_id(
                    app,
                    "export-pandoc-hint",
                    &t!("menu.file.export.pandocHint"),
                    true,
                    None::<&str>,
                )?)]
            };
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| &**i).collect();
        Submenu::with_id_and_items(
            app,
            "other-formats-submenu",
            &t!("menu.file.export.otherFormats"),
            true,
            &refs,
        )?
    };

    let html_item = MenuItem::with_id(
        app,
        "export-html",
        &t!("menu.file.export.html"),
        true,
        accel("export-html", ""),
    )?;
    let copy_html_item = MenuItem::with_id(
        app,
        "copy-html",
        &t!("menu.file.export.copyHtml"),
        true,
        accel("copy-html", "CmdOrCtrl+Shift+C"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;

    #[cfg(target_os = "macos")]
    let export_submenu = {
        let pdf_item = MenuItem::with_id(
            app,
            "export-pdf-native",
            &t!("menu.file.export.pdf"),
            true,
            accel("export-pdf-native", ""),
        )?;
        Submenu::with_id_and_items(
            app,
            "export-submenu",
            &t!("menu.file.export"),
            true,
            &[
                &html_item,
                &pdf_item,
                &other_formats_submenu,
                &separator,
                &copy_html_item,
            ],
        )?
    };

    #[cfg(not(target_os = "macos"))]
    let export_submenu = Submenu::with_id_and_items(
        app,
        "export-submenu",
        &t!("menu.file.export"),
        true,
        &[
            &html_item,
            &other_formats_submenu,
            &separator,
            &copy_html_item,
        ],
    )?;

    Ok(export_submenu)
}

#[cfg(test)]
#[path = "export_menu.test.rs"]
mod tests;

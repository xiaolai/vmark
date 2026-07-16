//! SF Symbol icon tables for the macOS application menu.
//!
//! Data-only lookup tables, extracted from `macos_menu.rs` (which owns the
//! apply logic) so both files stay under the file-size limit. Adding a menu
//! item icon is a one-line edit here.
//!
//! @coordinates-with macos_menu.rs — consumes these via `#[path] mod icons`

/// Maps menu item **IDs** (leaf items only) to SF Symbol names.
/// IDs come from `MenuItem::with_id(app, "THE-ID", ...)` in menu builders.
pub(crate) const MENU_ICONS: &[(&str, &str)] = &[
    // ── App menu ──
    ("about", "info.circle"),
    ("preferences", "gearshape"),
    ("save-all-quit", "rectangle.portrait.and.arrow.right"),
    ("quit", "power"),
    // ── File menu ──
    ("new", "doc.badge.plus"),
    ("new-window", "macwindow.badge.plus"),
    ("new-browser-tab", "globe"),
    ("quick-open", "magnifyingglass"),
    ("open", "folder"),
    ("open-folder", "folder.badge.gearshape"),
    ("close", "xmark"),
    ("close-workspace", "xmark.square"),
    ("save", "arrow.down.doc"),
    ("save-as", "arrow.down.doc.fill"),
    ("move-to", "folder.badge.questionmark"),
    // Export
    ("export-html", "doc.richtext"),
    ("export-pdf", "printer"),
    ("export-pdf-native", "arrow.up.doc"),
    ("export-pandoc-docx", "doc.richtext.fill"),
    ("export-pandoc-epub", "book"),
    ("export-pandoc-latex", "function"),
    ("export-pandoc-odt", "doc.text"),
    ("export-pandoc-rtf", "doc.plaintext"),
    ("export-pandoc-txt", "doc"),
    ("export-pandoc-hint", "info.circle"),
    ("copy-html", "doc.text"),
    // History
    ("clear-workspace-history", "clock.badge.xmark"),
    ("clear-history", "clock.badge.xmark"),
    // Recent
    ("clear-recent", "trash"),
    ("clear-recent-workspaces", "trash"),
    // ── Edit menu ──
    ("undo", "arrow.uturn.backward"),
    ("redo", "arrow.uturn.forward"),
    // Find
    ("find-replace", "magnifyingglass"),
    ("find-next", "chevron.down"),
    ("find-prev", "chevron.up"),
    ("use-selection-find", "text.magnifyingglass"),
    ("find-in-files", "doc.text.magnifyingglass"),
    // Selection
    ("select-word", "textformat.abc"),
    (
        "select-line",
        "arrow.left.and.line.vertical.and.arrow.right",
    ),
    ("select-block", "rectangle.dashed"),
    ("expand-selection", "arrow.up.left.and.arrow.down.right"),
    // Lines
    ("move-line-up", "arrow.up"),
    ("move-line-down", "arrow.down"),
    ("duplicate-line", "plus.square.on.square"),
    ("delete-line", "trash"),
    ("join-lines", "text.justify"),
    ("remove-blank-lines", "line.3.horizontal.decrease"),
    ("sort-lines-asc", "arrow.up.right"),
    ("sort-lines-desc", "arrow.down.right"),
    // Line Endings
    ("line-endings-lf", "l.circle"),
    ("line-endings-crlf", "c.circle"),
    // ── Format menu ──
    ("bold", "bold"),
    ("italic", "italic"),
    ("underline", "underline"),
    ("strikethrough", "strikethrough"),
    ("code", "chevron.left.forwardslash.chevron.right"),
    ("highlight", "highlighter"),
    ("subscript", "textformat.subscript"),
    ("superscript", "textformat.superscript"),
    ("clear-format", "paintbrush"),
    // Headings
    ("heading-1", "1.circle"),
    ("heading-2", "2.circle"),
    ("heading-3", "3.circle"),
    ("heading-4", "4.circle"),
    ("heading-5", "5.circle"),
    ("heading-6", "6.circle"),
    ("paragraph", "paragraph"),
    ("increase-heading", "plus.circle"),
    ("decrease-heading", "minus.circle"),
    // Lists
    ("ordered-list", "list.number"),
    ("unordered-list", "list.bullet"),
    ("task-list", "checklist"),
    ("indent", "increase.indent"),
    ("outdent", "decrease.indent"),
    ("remove-list", "xmark.circle"),
    // Blockquote
    ("quote", "text.quote"),
    ("nest-blockquote", "increase.indent"),
    ("unnest-blockquote", "decrease.indent"),
    // Transform
    ("transform-uppercase", "textformat.size.larger"),
    ("transform-lowercase", "textformat.size.smaller"),
    ("transform-title-case", "textformat"),
    ("transform-toggle-case", "arrow.up.arrow.down"),
    ("toggle-quote-style", "quote.opening"),
    // CJK
    ("format-cjk", "globe.asia.australia"),
    ("format-cjk-file", "doc.text.magnifyingglass"),
    // Text Cleanup
    ("remove-trailing-spaces", "eraser"),
    ("collapse-blank-lines", "rectangle.compress.vertical"),
    ("cleanup-images", "photo.badge.minus"),
    // ── Insert menu ──
    ("link", "link"),
    ("wiki-link", "link.badge.plus"),
    ("bookmark", "bookmark"),
    ("image", "photo"),
    ("video", "video"),
    ("audio", "waveform"),
    ("insert-table", "tablecells"),
    ("code-fences", "curlybraces"),
    ("math-block", "function"),
    ("diagram", "chart.xyaxis.line"),
    ("graphviz-diagram", "chart.xyaxis.line"),
    ("horizontal-line", "minus"),
    ("footnote", "note.text"),
    ("collapsible-block", "chevron.down.square"),
    ("mindmap", "brain"),
    // Table
    ("add-row-before", "arrow.up.to.line"),
    ("add-row-after", "arrow.down.to.line"),
    ("add-col-before", "arrow.left.to.line"),
    ("add-col-after", "arrow.right.to.line"),
    ("delete-row", "minus.rectangle"),
    ("delete-col", "minus.rectangle.portrait"),
    ("delete-table", "trash"),
    ("align-left", "text.alignleft"),
    ("align-center", "text.aligncenter"),
    ("align-right", "text.alignright"),
    ("align-all-left", "text.alignleft"),
    ("align-all-center", "text.aligncenter"),
    ("align-all-right", "text.alignright"),
    ("format-table", "wand.and.stars"),
    // Info Box
    ("info-note", "note.text"),
    ("info-tip", "lightbulb"),
    ("info-important", "exclamationmark.circle"),
    ("info-warning", "exclamationmark.triangle"),
    ("info-caution", "flame"),
    ("check-markdown", "checkmark.circle"), // ── View menu ──
    ("lint-next", "chevron.down"),
    ("lint-prev", "chevron.up"),
    ("wysiwyg-mode", "doc.richtext"),
    ("source-mode", "chevron.left.forwardslash.chevron.right"),
    ("markdown-split", "rectangle.split.2x1"),
    ("focus-mode", "eye"),
    ("typewriter-mode", "character.cursor.ibeam"),
    ("zoom-actual", "1.magnifyingglass"),
    ("zoom-in", "plus.magnifyingglass"),
    ("zoom-out", "minus.magnifyingglass"),
    ("word-wrap", "arrow.right.to.line"),
    ("line-numbers", "number"),
    ("diagram-preview", "eye.square"),
    (
        "fit-tables",
        "arrow.left.and.right.righttriangle.left.righttriangle.right",
    ),
    ("read-only", "lock"),
    ("show-invisibles", "paragraphsign"),
    ("outline", "list.bullet.indent"),
    ("file-explorer", "folder"),
    ("view-history", "clock.arrow.circlepath"),
    ("knowledge-base", "books.vertical"),
    ("toggle-terminal", "terminal"),
    // ── Window menu ──
    ("window-status", "rectangle.stack"),
    ("bring-all-to-front", "macwindow.on.rectangle"),
    // ── Help menu ──
    ("vmark-help", "questionmark.circle"),
    ("keyboard-shortcuts", "keyboard"),
    ("install-cli", "terminal"),
    ("report-issue", "exclamationmark.bubble"),
    // ── Genies menu (structural items) ──
    ("search-genies", "sparkles"),
    ("no-genies", "sparkles"),
    ("reload-genies", "arrow.clockwise"),
    ("open-genies-folder", "folder"),
];

/// Icons for PredefinedMenuItems (Cut, Copy, etc.) which don't have custom IDs.
/// Mapped by the muda default title text (after mnemonic stripping).
/// When `None` is passed to PredefinedMenuItem constructors, muda generates these
/// titles automatically. This is a best-effort match for English locale.
pub(crate) const PREDEFINED_ICONS: &[(&str, &str)] = &[
    ("Cut", "scissors"),
    ("Copy", "doc.on.doc"),
    ("Paste", "doc.on.clipboard"),
    ("Select All", "checkmark.square"),
    ("Services", "gear"),
    ("Hide VMark", "eye.slash"),
    ("Hide Others", "eye.slash.circle"),
    ("Show All", "eye"),
    ("Minimize", "minus.square"),
    ("Zoom", "arrow.up.left.and.arrow.down.right"),
    ("Maximize", "arrow.up.left.and.arrow.down.right"),
    ("Toggle Full Screen", "arrow.up.left.and.arrow.down.right"),
    ("Close Window", "xmark.square"),
];

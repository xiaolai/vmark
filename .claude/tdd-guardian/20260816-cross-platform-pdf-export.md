# Cross-platform PDF export (#1284)

**Status:** Phase 0 complete (spike, measured). Phase 1 not started.
**Home:** tracked — the measured findings below are not reproducible by
re-running anything cheap, and Phase 2/3 DoD is a CI job.
**WI namespace:** `WI-PDF*` (see `60-ai-governance.md` §1 — a bare `WI-1.1`
is satisfied by any other plan's `WI-1.1`).

## Problem

PDF export and Print exist only on macOS. `src-tauri/src/pdf_export/` is
`#[cfg(target_os = "macos")]` in three places — `lib.rs`, both
`command_registry.rs` entries, and `menu/localized/export_menu.rs`. Windows
and Linux users have no PDF export at all; #929 was closed by *hiding the
menu items*, which is why this issue exists.

Everything above the backend is already platform-neutral:
`pdfHtmlTemplate.ts`, `pdfPresets.ts`, `PdfSettingsSidebar.tsx`.

## Phase 0 — spike (COMPLETE, measured 2026-08-16)

Both platforms can produce a PDF non-interactively from the webview they
already have. No bundled renderer, no external binary, no new bindings.

| Platform | API | Result |
|---|---|---|
| Windows | `ICoreWebView2_7::PrintToPdf` | `hr=0x00000000`, `%PDF-1.4`, A4 honoured |
| Linux | `webkit_print_operation_print()` | `%PDF-1.4`, 411 KB, A4 honoured |

### ADR-PDF1 — page geometry travels through the API, not through CSS

**Measured on both platforms, three variants each.** A4 = 595×842 pt,
A5 = 420×595 pt:

| Variant | CSS `@page` | API | Windows | Linux |
|---|---|---|---|---|
| `css_only` | A5 | A4 | **A4** | **A4** |
| `api_only` | *(none)* | A5 | **A5** | **A5** |
| `conflict` | A4 | A5 | **A5** | **A5** |

`@page { size }` is **ignored** by both backends. The API wins every time,
including when CSS explicitly disagrees.

**macOS is the exception, and it is the shipped behaviour.**
`renderer.rs::configure_print_info` copies `NSPrintInfo::sharedPrintInfo()`
(the system default paper), zeroes all four margins, and **never sets a paper
size** — because `pdfHtmlTemplate.ts`'s header records that WebKit's
`printOperationWithPrintInfo` pipeline *does* honour `@page` size and margins.
So macOS geometry is CSS-driven and the other two are API-driven.

**Consequence:** `export_pdf` must take the page geometry as an argument. The
user's page-size and margin choices currently reach Rust **only** as generated
CSS, so a Windows or Linux backend written against today's signature would
silently emit the platform default paper regardless of what the dialog says —
a success flag over a wrong-sized page, which is indistinguishable from
working at the API level.

This was not obvious: the first two probes set CSS *and* API to the same value
and so proved nothing about precedence. It cost one 10-minute re-probe and
would have cost a wrong command signature.

### ADR-PDF2 — the Linux settings object needs both keys, for two reasons

| Print settings | Result |
|---|---|
| `output-uri` only | `WebKitPrintError` 500 `"Printer not found"` |
| `output-uri` **and** `set_printer("Print to File")` | success |
| printer only, no `output-uri` | **`finished`, no `failed`, no file at the requested path** |

The third row is the trap that has stalled this upstream: it writes
`output.pdf` into the process's *current working directory* and reports
success. Where the fallback path is not writable it instead raises a
filesystem error naming a path nobody chose. Whether it fails loudly or
silently is decided by the environment, not the code.

Note also that `GtkPrintJob` alone is satisfied by `output-uri` without a
printer — the two GTK layers disagree about what a complete settings object
is. Do not carry a `GtkPrintJob` result upward to `WebKitPrintOperation`.

### ADR-PDF3 — bookmarks degrade, deliberately

`bookmarks.rs` is PDFKit. Windows and Linux ship **without** the heading
outline. `commands.rs` already treats bookmark failure as non-fatal, so the
structure absorbs it. This is a stated fidelity gap, not a silent one — it
belongs in the release notes. A cross-platform outline (`lopdf`) is a
follow-up, explicitly out of scope here.

## Design

```
pdf_export/                  ← unconditional (today: macOS-only)
  commands.rs                ← validation, i18n errors, progress, bookmarks
  bookmarks.rs               ← PDFKit; macOS-gated internally
  renderer/
    mod.rs                   ← cfg-selects; declares the contract
    macos.rs                 ← today's 529 lines, behaviour unchanged
    windows.rs               ← ICoreWebView2_7::PrintToPdf
    linux.rs                 ← webkit_print_operation_print
```

One contract, three implementations:

```rust
pub async fn render_pdf(
    app: AppHandle, html: String, output: String, page: PageSpec,
) -> Result<(), CommandError>;
```

Path validation, extension checks, `pdf-export-progress` emission, localized
error keys and the bookmark call are written once in `commands.rs`. Only the
off-screen webview lifecycle is per-platform — which is where macOS's 529
lines went, so expect real code in each, not shims.

**Async model:** every platform resolves a `tokio::sync::oneshot` from its own
callback — macOS from the runloop, Windows from the COM completion handler,
Linux from GLib's `finished`/`failed` signals. The command awaits the
receiver. One async shape over three unrelated event systems.

**`PageSpec`** carries width/height and the four margins in a single unit
(pt), converted per platform (WebView2 wants inches, GTK wants a
`GtkPaperSize`). macOS ignores it initially — its CSS path already works and
changing it risks a regression in the one platform that ships today.

## Phases

| WI | Work | Definition of Done |
|---|---|---|
| `WI-PDF1.1` | `pdf_export` unconditional; `renderer/` split; macOS moved verbatim | macOS export byte-identical on a fixture; `cargo test` green on all three OSes |
| `WI-PDF1.2` | Both commands → `CommandError`; frontend call sites updated | `lint:command-errors` baseline drops; no `String(error)` on a typed command |
| `WI-PDF1.3` | `PageSpec` threaded from `PdfExportDialog` through `export_pdf` | unit test: dialog preset → `PageSpec` mapping |
| `WI-PDF2.1` | Windows renderer | CI `rust-test (windows-latest)` smoke: `%PDF`, page count, MediaBox |
| `WI-PDF3.1` | Linux renderer | CI `rust-test (ubuntu-latest)` under `xvfb-run`, same assertions |
| `WI-PDF4.1` | `print_document`: `ShowPrintUI` / `run_dialog()` | manual — it is a dialog |
| `WI-PDF5.1` | Ungate menu; i18n; `website/guide/export.md` | `lint:i18n`, `lint:keybinding-manifest` |

`WI-PDF1.x` is worth landing alone even if 2/3 stall: it removes a `#[cfg]`
from three places and converts two legacy `Result<T, String>` commands.

## Testing

The smoke test is the point. `rust-test` already runs a three-OS matrix, so a
test that renders a fixed HTML and asserts `%PDF`, page count **and**
MediaBox turns "compiling is not running" into real coverage on exactly the
feature where that gap has cost the most.

Linux CI needs `xvfb-run` — GitHub's ubuntu runners have no display. The
spike only avoided it because WSLg supplied one.

**Assert the MediaBox, never just the magic bytes.** A backend that ignores
`PageSpec` still emits a valid `%PDF` at the platform default; ADR-PDF1 is
precisely the failure a magic-byte assertion cannot see.

## Out of scope

- Cross-platform PDF outline/bookmarks (`lopdf`) — ADR-PDF3
- `@page` margin boxes (`@top-center` etc.) — unsupported by WebKit print
- Changing macOS geometry handling — it ships and it works

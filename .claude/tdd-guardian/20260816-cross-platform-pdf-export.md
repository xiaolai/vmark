# Cross-platform PDF export (#1284)

**Status:** Phase 0 complete (spike + adversarial review). Phase 1 not started.
**Home:** tracked — the measured findings are not reproducible by re-running
anything cheap, and the Phase 2/3 DoD is a CI job.
**WI namespace:** `WI-PDF*` (`60-ai-governance.md` §1).
**Cross-model review:** Codex, refute mode, 2026-08-16 (§6). It **rejected the
first draft**. Four of its objections were verified against this repo and are
folded in below; one was a valid attack on my evidence and forced a re-probe.

## Problem

PDF export and Print exist only on macOS. Windows and Linux users have none;
#929 was closed by *hiding the menu items*, which is why #1284 exists.

## Phase 0 — spike (COMPLETE, measured 2026-08-16)

### WI-PDF0.1 — finish the geometry matrix

**Status:** DONE — 2026-08-16
**Changed:** this plan (ADR-PDF1 `no_api` row, new ADR-PDF1a, `PageSpec` contract)
**Verified:** probes on real Windows and Linux (WSL x86_64); 5 Windows variants
and 4 Linux variants, page count + MediaBox extracted from each artifact


Both platforms produce valid PDFs from the webview they already have. No
bundled renderer, no external binary, no new bindings to author.

| Platform | API | Result |
|---|---|---|
| Windows | `ICoreWebView2_7::PrintToPdf` | `hr=0`, `%PDF-1.4`, requested size honoured |
| Linux | `webkit_print_operation_print()` | `%PDF-1.4`, requested size honoured |

### ADR-PDF1 — page geometry must travel through the API

A4 = 595×842 pt, A5 = 420×595 pt.

| Variant | CSS `@page` | API | Windows | Linux |
|---|---|---|---|---|
| `css_only` | A5 | A4 | A4 | A4 |
| `api_only` | *(none)* | A5 | A5 | A5 |
| `conflict` | A4 | A5 | A5 | A5 |
| `no_api` | A5 | **omitted entirely** | **Letter (612×792)** | **A4 — the GTK default** |

**The `no_api` row is load-bearing and the first draft did not have it.** Codex
correctly observed that the first three rows only prove *an explicit API value
beats CSS* — they leave open that CSS might be honoured when no API geometry is
supplied, which would permit keeping today's signature. Measured: it is not.
With no page setup at all, Linux emits the GTK default and ignores `@page`
outright. **A CSS-only contract cannot work.**

The conclusion survived; the evidence for it did not, and was replaced.
`no_api` measured on **both**: Windows with NULL print settings emits US
Letter, Linux with no page setup emits A4. Each falls back to its own platform
default and neither reads `@page`. The conclusion holds on both.

**macOS is the exception and it is the shipped behaviour.**
`renderer.rs::configure_print_info` copies `NSPrintInfo::sharedPrintInfo()`,
zeroes all four margins, and never sets a paper size, because
`pdfHtmlTemplate.ts`'s header records that WebKit's
`printOperationWithPrintInfo` pipeline honours `@page`. macOS is CSS-driven;
the other two are API-driven.

### ADR-PDF1a — the three properties have three different authorities

Measured (WI-PDF0.1), page **count** as the margin signal — a smaller
printable area fits less of a fixed-height document:

| Property | Windows | Linux |
|---|---|---|
| Page **size** | API (`SetPageWidth/Height`) | API (`GtkPageSetup` paper) |
| **Margins** | **CSS** — API margins measurably ignored | **CSS** — same |
| **Orientation** | **width/height swap**; the orientation *enum* had no effect while w/h were set | API enum (MediaBox flips) |

Margin control, both platforms (`margin_none` is the zero/zero baseline):

| Variant | CSS | API | Windows pages | Linux pages |
|---|---|---|---|---|
| `margin_none` | 0 | 0 | 4 | 4 |
| `margin_api` | 0 | 40 mm | **4 — no change** | **4 — no change** |
| `margin_css` | 40 mm | 0 | 5 | 6 |

**This is why `PageSpec` must not carry margins.** Passing them only through
the API would have dropped the user's margin choice silently on both
platforms, behind a valid `%PDF` at the right page size — the exact shape of
failure a magic-byte assertion cannot see.

**And orientation must be expressed as a width/height swap**, not as an enum:
Windows ignored `COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE` while explicit
width/height were set. Swapping is correct on both.

### ADR-PDF2 — the Linux settings object needs both keys, for two reasons

| Print settings | Result |
|---|---|
| `output-uri` only | `WebKitPrintError` 500 `"Printer not found"` |
| `output-uri` **and** `set_printer("Print to File")` | success |
| printer only, no `output-uri` | **`finished`, no `failed`, no file at the requested path** |

The third row writes `output.pdf` into the process CWD and reports success;
where the fallback path is unwritable it instead raises a filesystem error
naming a path nobody chose. Environment decides which — the code looks the
same either way.

`GtkPrintJob` alone *is* satisfied by `output-uri` without a printer. The two
GTK layers disagree about what a complete settings object is; do not carry a
`GtkPrintJob` result upward to `WebKitPrintOperation`.

### ADR-PDF3 — bookmarks degrade, deliberately

`bookmarks.rs` is PDFKit. Windows and Linux ship without the heading outline;
`commands.rs` already treats bookmark failure as non-fatal. A stated gap, not
a silent one — it belongs in the release notes. `lopdf` is a follow-up.

**`bookmarks::Heading` still needs a compilable non-macOS shape** — it is in
the `export_pdf` signature, so gating the PDFKit imports alone is insufficient.

### ADR-PDF4 — HTML reaches the webview as a file URL, never as a string

wry documents a **2 MiB limit** on `.with_html` (it is `NavigateToString`
underneath). VMark inlines images as data URIs
(`useExportOperations.ts:342`), so real exports routinely exceed that. The
macOS renderer already writes a temp file for this reason
(`renderer.rs:174`). The Phase 0 Windows probe used `.with_html` and would
have hit this in Phase 2.

The temp file must survive until navigation completes, not until the
dispatching function returns.

### ADR-PDF5 — reuse Tauri's WebView2 environment; never create a second one

Tauri forces a writable LocalData user-data folder; wry adds non-default
environment options and warns that the same folder with differing options
fails. A raw environment matching the spike can fail after a non-admin
install. Tauri exposes the live one via `PlatformWebview::environment()`, and
VMark already injects `WebviewWindow` for this class of work
(`browser/commands.rs:38`).

**Reject any implementation that constructs a raw environment with a default
or null user-data folder.**

### ADR-PDF6 — the execution model, stated correctly

The first draft said all three platforms "resolve a oneshot from a platform
callback". **macOS does not** — it dispatches one synchronous closure, spins
`NSRunLoop`, and sends after rendering finishes (`renderer.rs:208`).

Windows posts callbacks to the creating STA's pump; Linux signals run on the
owning GLib context. `oneshot` transports completion; it pumps nothing. The
valid sequence for the two new platforms is:

> dispatch to UI thread → create and **retain** objects → register callbacks
> → **return** to tao/GLib → callback sends → the Tokio task awaits

Awaiting or blocking inside the UI closure deadlocks. Constructing on a Tokio
worker gives COM wrong-apartment errors or GTK criticals.

What *is* shared, and already proven in this repo: the outer shell of
`render_pdf` — temp file, `run_on_main_thread`, oneshot, `tokio::timeout`,
cleanup — is platform-neutral today. Only `render_pdf_on_main_thread` is
macOS-specific.

### ADR-PDF7 — timeout is not cancellation

Dropping the receiver leaves native work running: it can write the output file
*after* the command reported failure, and retain Edge/GTK objects forever.
Each renderer owns explicit teardown on the timeout path.

## Design

### WI-PDF1.1 — restructure, split, non-macOS stubs

**Status:** DONE — 2026-08-16
**Changed:** `src-tauri/src/pdf_export/{mod.rs,commands.rs,bookmarks.rs,heading.rs}`,
`src-tauri/src/pdf_export/renderer/{mod.rs,macos.rs,macos_ops.rs,windows.rs,linux.rs}`
(replacing `renderer.rs`), `src-tauri/src/lib.rs`,
`src-tauri/src/command_registry.rs`, `scripts/file-size-baseline.json`,
all ten `src-tauri/locales/*.yml`
**Verified:** `cargo clippy --all-targets -- -D warnings` clean;
`cargo test --lib` 2142 passed; `pnpm lint:file-size` green;
`scripts/check-cross-target.sh` — **x86_64-pc-windows-gnu compiles clean**,
which is the actual point: the stubs make a non-macOS build real

Notes worth keeping:
- `Heading` moved to its own `heading.rs`. It is in the `export_pdf`
  signature, so leaving it inside the PDFKit module made the whole command
  macOS-only by transitivity.
- The file-size gate fired exactly as ADR predicted — a stale `renderer.rs`
  entry *and* `bookmarks.rs` shrinking 394 → 389. Both ratcheted down.
- The cross-compile caught what the macOS build could not: `PdfProgress` and
  `emit_progress` are unused on Windows because the stub refuses before there
  is progress to report. Annotated so the attribute goes inert — rather than
  wrong — once WI-PDF2.1 calls them.

### WI-PDF1.3 — one geometry source, two derivations

**Status:** DONE — 2026-08-16
**Changed:** `src/export/{pageSpec.ts,pageSpec.test.ts,PdfExportDialog.tsx,pdfHtmlTemplate.ts}`,
`src-tauri/src/pdf_export/{page_spec.rs,page_spec.test.rs,mod.rs,commands.rs}`,
`src-tauri/src/pdf_export/renderer/{mod.rs,macos_ops.rs,windows.rs,linux.rs}`,
all ten `src-tauri/locales/*.yml`
**Verified:** `cargo test --lib` 2155 passed (7 new for `PageSpec`);
`pnpm vitest run src/export` 403 passed (7 new); clippy, **cross-target**,
`lint:ipc-contract` (172 invoked commands resolve), file-size, typecheck green

**DoD amended, and why:** the row above originally required
"impossible-margin rejection". That predates ADR-PDF1a, which *measured*
margins as CSS-driven — so `PageSpec` carries none and there is no margin to
reject. Validating a field the type does not have would have been theatre.
Replaced with out-of-range rejection, which is the real risk.

Notes worth keeping:
- The CSS keeps using CSS **keywords** (`A4 landscape`) because
  `pdfHtmlTemplate.ts` records that an explicit length pair plus an
  orientation keyword is invalid and silently ignored by WebKit. So there are
  necessarily two tables; `pageSpec.test.ts` fails if one gains an entry the
  other lacks, which is the drift that would matter.
- A test asserts snake_case is **rejected**, so a casing regression cannot
  pass silently — the fixture is the literal payload the dialog sends.
- `is_finite` is load-bearing in `validate`: `NaN` fails every comparison, so
  a range check alone would hand `NaN` to a native print API.
- The cross-compile caught `inches()` as dead on the Windows *target* — the
  conditional allow I wrote applies everywhere except the one platform that
  will use it.

### WI-PDF1.2 — typed errors end to end

**Status:** DONE — 2026-08-16
**Changed:** `pdf_export/{commands.rs,commands.test.rs}`,
`pdf_export/renderer/{mod.rs,macos.rs,macos_ops.rs,windows.rs,linux.rs}`,
`src/export/{PdfExportDialog.tsx,useExportOperations.ts,pdfExportError.test.ts}`,
`src/utils/errorMessage.ts`, `scripts/command-error-baseline.json`,
all ten `src-tauri/locales/*.yml` (5 new keys)
**Verified:** `cargo test --lib` 2148 passed (6 new, each pinning a CODE);
`pnpm vitest run src/export` 396 passed; `pnpm lint:command-errors` — ratchet
held and **dropped by 2**; clippy, cross-target, file-size, typecheck green

Notes worth keeping:
- The renderer contract returns `CommandError` all the way down, not just at
  the command boundary. Converting only the boundary would have meant
  string-matching the timeout to give it a code — the exact anti-pattern the
  type exists to end.
- Validation was extracted to `validate_output_path`. `export_pdf` takes a
  concrete `AppHandle`, so a test going through the command would have needed
  a real webview to check a string.
- The two validation failures carry **different** codes, and a test asserts
  they differ — same code would put the frontend back on message text.
- The `command-error-ok` markers I first added pushed a baselined file over
  its cap. The better fix removed the need for them: `toError()` names the
  normalise-to-Error idiom, so no `String(error)` remains in that file at all.

```
pdf_export/                  ← unconditional
  commands.rs                ← validation, i18n errors, progress, bookmarks
  bookmarks.rs               ← PDFKit; macOS-gated, with a non-macOS Heading
  renderer/
    mod.rs                   ← the whole outer shell + the contract
    macos.rs                 ← today's main-thread body, SPLIT (see WI-PDF1.1)
    windows.rs               ← ICoreWebView2_7::PrintToPdf
    linux.rs                 ← webkit_print_operation_print
```

Two contracts, not one — `commands.rs` calls **both**:

```rust
async fn render_pdf(app, html, output, page: PageSpec) -> Result<(), CommandError>;
async fn print_document(app, html) -> Result<(), CommandError>;
```

`PageSpec` carries **width and height in points, orientation already applied**
by the caller (landscape = swapped). It carries **no margins** — ADR-PDF1a
measured those as CSS-driven on both platforms. It is built **once** on the
frontend and feeds both the CSS and the IPC payload, so the two authorities
cannot disagree.

## Phases

| WI | Work | Definition of Done |
|---|---|---|
| `WI-PDF0.1` | Finish the matrix: `no_api` on Windows; margins/orientation both platforms | the two pending cells above filled with measurements |

| `WI-PDF1.1` | `pdf_export` unconditional; `renderer/` split; **non-macOS stubs returning typed `unsupported`** for both contracts | `cargo clippy` green on all three targets; `pnpm lint:file-size` green |
| `WI-PDF1.2` | Both commands → `CommandError`; `PdfExportDialog.tsx:159` → `commandErrorMessage` | table test mapping `invalid-input`/`not-found`/`io`/`timeout`; frontend test asserts the message text, never `[object Object]` |
| `WI-PDF1.3` | `PageSpec` from one source → CSS **and** IPC | Rust deserialization test against the exact frontend JSON incl. camelCase; non-finite and out-of-range rejection |
| `WI-PDF2.1` | Windows renderer + **direct Cargo deps** | see harness note below; >2 MiB fixture; 20 sequential + 2 concurrent exports leave no orphan |
| `WI-PDF3.1` | Linux renderer + direct Cargo deps | same, under `xvfb-run`; Unicode path test (`PDF #测试 100%.pdf`) |
| `WI-PDF4.1` | `print_document` for both | manual — it is a dialog |
| `WI-PDF5.1` | Remove **both** frontend guards; ungate `export_menu.rs` **and** `file_menu.rs`; opener capability | non-macOS menu shows both items; `capabilities.test.rs` requires `opener:allow-open-path` |

### Corrections forced by review, each verified against this repo

- **The frontend is *not* platform-neutral.** `useExportOperations.ts:252` and
  `:273` return early with a "requires Mac" toast, and Print is separately
  gated in `file_menu.rs:118` — a file the first draft never named. Ungating
  `export_menu.rs` alone recreates #929. *(verified)*
- **`cargo test` cannot host the smoke test on Windows.** Tauri's `test`
  feature is deliberately excluded there because MockRuntime dies with
  `STATUS_ENTRYPOINT_NOT_FOUND` (`Cargo.toml:139`), and MockRuntime runs
  "main-thread" work inline with `with_webview` as a no-op — so it would prove
  nothing even where it links. The DoD is therefore **a real-wry smoke binary
  or an E2E job**, not `cargo test`. Linux CI also installs no Xvfb today.
  *(verified)*
- **"Moved verbatim" collides with the file-size gate.** `renderer.rs` (529)
  and `bookmarks.rs` (394) are baselined at their current paths; the gate
  ratchets two-way, so a move makes the old entry stale *and* the new path an
  unbaselined violation. WI-PDF1.1 must **split**, not move. *(verified)*
- **Post-export "open in viewer" is already broken.** `PdfExportDialog.tsx:151`
  calls `openPath()` but `capabilities/pdf-export.json` grants no
  `opener:allow-open-path`; the failure is swallowed. A live shipped bug found
  by this review. *(verified)*
- **"No new bindings" ≠ no manifest work.** `webview2-com`, `windows`,
  `webkit2gtk`, `gtk`, `glib` are transitive only; VMark cannot import them
  without declaring them, and versions must match what wry resolves or the COM
  and GTK types are nominally distinct. Promotion belongs in WI-PDF2.1/3.1.
- **Linux takes a URI, not a path.** Naive `file://` + path breaks spaces,
  `#`, `%` and CJK — and a broken URI can re-trigger ADR-PDF2's CWD fallback.

## Testing

Assert the **MediaBox and page count**, never just the magic bytes: a backend
that ignores `PageSpec` still emits a valid `%PDF` at the platform default,
which is precisely the ADR-PDF1 failure.

**Byte-identical is not a sound DoD** for WI-PDF1.1. PDFs embed
`CreationDate`, `ModDate` and a document `/ID`, and PDFKit rewrites the file
when bookmarks are added (`bookmarks.rs:117`), so behaviourally identical runs
differ byte-for-byte. Compare *parsed* page boxes, page count, extracted text
and outline destinations instead — plus a plain source diff of the moved
function bodies for the mechanical part.

## Out of scope

- Cross-platform outline (`lopdf`) — ADR-PDF3
- `@page` margin boxes — unsupported by WebKit print
- Changing macOS geometry handling — it ships and it works

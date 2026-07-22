# ADR Reality Audit — all 14 ADRs vs. the code

> Date: 2026-07-22 | Method: two parallel read-only code audits, every claim
> grep/read-verified with file:line anchors; stated verification gates were
> executed where runnable. Worktree `refactor/vmark-core` @ `a43642e4`.
> Trigger: ADR-011 and ADR-010 were found false while drafting ADR-015. This
> audit asks which *other* Accepted ADRs no longer describe reality.

## Verdict

**4 FALSE, 6 DRIFTED, 4 HOLD.**

| ADR | Claimed | Verdict | Reason |
|---|---|---|---|
| 001 Markdown as source of truth | Accepted | **HOLDS** | Store genuinely holds an opaque string; no structure leaks. But "incremental updates" mitigation is fictional, and scope silently widened to 60+ extensions plus browser tabs |
| 002 MCP sidecar | Accepted | **DRIFTED** | Architecture intact; "no Node.js runtime dependency in the main app" false app-wide — `content_server/spawn.rs:28` PATH-resolves `node`. `mcp-troubleshooting.md` does not exist |
| 003 Tiptap over Milkdown | Accepted | **DRIFTED** | Milkdown removal total (0 hits in lockfile or source). But "serialization decoupled from *both* frameworks" is half-false — 11/19 pipeline files import `@tiptap/pm/model` and ProseMirror is in the public signature |
| 004 Human-oriented MCP tools | Superseded (file) / Accepted (README) | **HOLDS as superseded** | Old 60-tool surface verifiably gone; note says 5 tools, reality is 7; README index status wrong |
| 005 CLI-based AI provider routing | Accepted | **FALSE (core premise)** | The explicitly-*rejected* Option 1 (direct REST + managed API keys) is fully implemented and shipping. "Zero API key management" contradicted by an OS-keychain subsystem |
| 006 Terminal TERM_PROGRAM | Accepted | **HOLDS** | Implemented and **unit-test-guarded** — the only ADR in the range with a real automated gate |
| 007 Shell as composition root | Accepted | **DRIFTED** | 3/4 gates pass, gate 4 fails. The Decision's slot API (`bottomBar`/`panels`/`PanelHost`/`OverlayHost`) does not exist; `App.tsx:224-246` hardcodes 15 overlays |
| 008 Workspace as single facade | Accepted | **FALSE** | `useWorkspace()` has **zero** production imports; 105 direct private-store reads remain in UI |
| 009 Document as unit of state | Accepted | **DRIFTED (severe)** | `editorStore.ts` was deleted by the ADR then **re-created** by a later refactor (`7e721384`); 220 refs. `useActiveDocument()` never existed |
| 010 Editor host | Accepted | **FALSE** | `EditorHost` appears only in 2 comments; 7 `source*Popup` dirs remain (gate demands 0) |
| 011 Plugin manifest contract | Accepted | **FALSE** | 76/77 manifests are ≤12-line stubs; `pluginsFor()` has zero callers |
| 012 Command bus | Accepted | **DRIFTED → near FALSE** | Two live parallel menu routers; 16 stray `listen("menu:")`; 83 editing actions unreachable from the Command Palette |
| 013 Service tier | Accepted | **HOLDS** | dep-cruise 0 errors, baseline `[]`, `utils/` genuinely pure. One flat file, cosmetic naming drift |
| 014 Theme tokens as typed data | Accepted | **HOLDS** | Typed catalog is the real source of truth; `useTheme.ts` carries zero color literals; codegen gate obsolete |

## The pattern: foundation-shaped dead code, three for three

`useWorkspace()` (ADR-008), `pluginsFor()` (ADR-011), and `EditorHost` (ADR-010)
were each landed as an API surface, marked **Accepted**, and never adopted. Add
ADR-007's slot system — `SlotDescriptor` exists as a type with no host, no
`PanelHost`, no `OverlayHost`, and no registration API — and it is four.

> **"The file exists" is zero evidence.** An acceptance gate must count
> *adoption*, not existence.

## Why the drift happened: gates that cannot fail

Only **ADR-006** has an automated guard (`spawnPty.test.ts:416` asserts
`TERM_PROGRAM === "WezTerm"`), and it is the one that survived untouched. ADR-007
is the only other ADR that *states* gates — all four are manual greps absent from
`check:all`, `.dependency-cruiser.cjs`, and CI. Its isolation currently holds by
accident, not construction.

Worse, **textual gates produce false greens.** ADR-012's gate greps for
`listen("menu:` and reports success — while `useUnifiedMenuCommands.ts:350`
dispatches through a *variable* event id over an 88-entry map, i.e. an entire
second router the gate structurally cannot see.

And **nothing guards a deletion.** ADR-009 deleted `editorStore.ts`; a later
refactor re-created the filename for a different concept and no gate noticed.

## Findings that directly constrain ADR-015

1. **The shell slot seam does not exist on either side.** Any extension model
   assuming "panels/overlays register into shell slots" is building on a contract
   with zero implementation at both ends — the identical shape to ADR-011.

2. **The markdown pipeline is ProseMirror-coupled in its public API.**
   `parseMarkdown(schema: Schema, …)` / `serializeMarkdown(schema, doc: PMNode, …)`
   (`adapter.ts:42,84`); 11 of 19 non-test files import `@tiptap/pm/model`. The
   genuinely independent seam is only `nodeSafe.ts` + `plugins/` (verified zero
   `@tiptap` imports). **ADR-015's two-registry split is therefore creating a
   boundary, not preserving one** — and `nodeSafe.ts:16` needs a lint rule, not
   just a comment.

3. **Two disjoint command registries, editing surface in the wrong one.** 49
   `registerCommand()` sites vs 83 `ActionId`s, **no bridge**. Typing "bold" into
   the Command Palette returns nothing. Any "extensions declare commands" API must
   pick a side, and each choice forfeits the other.

4. **ADR-005 is the process precedent.** A rejected option was implemented in
   full without amending the ADR. The gap that allowed it — no requirement to
   touch an ADR when contradicting it — matters more than the specific drift.

5. **Store scope has outgrown ADR-001.** `documentStore` backs 60+ extensions
   including binaries; `tabStore` has a `kind: "browser"` species with no document
   at all. An extension model keyed on "markdown document" will not cover the tab
   kinds already shipping.

## Recommended follow-up (not part of the extension plan)

- Re-status ADR-005, ADR-008, ADR-010, ADR-011 as **Superseded** or **Rejected in
  practice**; they currently mislead anyone reading `dev-docs/decisions/`.
- Fix `dev-docs/decisions/README.md` — ADR-004 is listed Accepted but is
  Superseded; ADR-006's date is blank.
- Repair stale paths that break grep navigation: `mcp_bridge.rs` → `mcp_bridge/`,
  `ai_provider.rs` → `ai_provider/`, and the dangling `mcp-troubleshooting.md`.
- Refresh ADR-009 and ADR-014 text, which *understate* reality — their caveats
  describe a world two refactors old. Understatement damages credibility during
  triage just as overstatement does.

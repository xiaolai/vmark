# Testing Hardening — Mutation Testing & Fuzzing

> Audit L13 / RW-14 — hardening items v1-017, v2-016 (mutation testing) and
> v2-017 (parser fuzzing).

Two opt-in, locally-runnable hardening tools for the Rust backend. **Neither is
required for the normal build** — `cargo test`/`cargo check` and CI are
unaffected if the tool binaries aren't installed. They are deliberately scoped
to a few pure-logic modules so a run is fast and the signal is high.

## Mutation testing — `cargo-mutants`

Mutation testing verifies that the test suite actually *catches* regressions: it
applies small, behavior-changing edits ("mutants") to the source and checks that
some test then fails. A surviving mutant means a code path is untested or
under-asserted.

### Scope

Config lives in [`src-tauri/mutants.toml`](../src-tauri/mutants.toml). It scopes
mutation to three high-branching, well-tested, pure-logic modules:

| Module | Why |
|---|---|
| `src/workflow/expressions.rs` | `resolve()` — multi-step expression parser with manual byte-slicing and several error branches. |
| `src/workflow/condition.rs` | `evaluate_condition()` — boolean condition evaluator with many comparison/logic branches. |
| `src/genies/parsing.rs` | `parse_genie()` — frontmatter/body splitting + YAML deserialization. |

The rest of the Tauri backend is I/O / FFI glue where mutation testing yields
little without a running app, so it is excluded.

### Run it

```bash
cargo install cargo-mutants
cargo mutants --manifest-path src-tauri/Cargo.toml
```

Each surviving mutant is a candidate test gap. To widen scope, add files to
`examine_globs` in `src-tauri/mutants.toml`.

### CI

`.github/workflows/mutation.yml` runs the scoped suite **only** on manual
`workflow_dispatch` and a weekly schedule — never on every PR (it is slow and
non-blocking). The job does not fail the build on surviving mutants; it is a
signal source, not a gate.

## Parser fuzzing — `cargo-fuzz`

Fuzzing feeds a parser huge volumes of malformed/adversarial input to find
inputs that panic (slice-on-non-char-boundary, unwrap-on-malformed-YAML, etc.).
The fuzz crate lives in [`src-tauri/fuzz/`](../src-tauri/fuzz/).

### Isolation from the normal build

This is the important part. The fuzz crate needs **nightly Rust + libfuzzer**,
which must never touch the normal `cargo test`/`cargo check` path:

- `src-tauri/Cargo.toml` has **no `[workspace]` table**, so cargo never
  auto-includes the `fuzz/` subdirectory. `cargo test/check --manifest-path
  src-tauri/Cargo.toml` ignores it entirely.
- `src-tauri/fuzz/Cargo.toml` declares its **own empty `[workspace]` table**,
  making it a standalone workspace root. Even if a `[workspace]` is later added
  to the parent package, the fuzz targets stay isolated.

### Targets

| Target | Fuzzes |
|---|---|
| `resolve_expression` | `vmark_lib::workflow::expressions::resolve` |
| `parse_genie` | `vmark_lib::genies::parse_genie_for_runner` (re-export of `genies::parsing::parse_genie`) |

To make these reachable, `mod genies;` and `mod workflow;` in
`src-tauri/src/lib.rs` were promoted to `pub mod`. `resolve` and
`parse_genie_for_runner` were already public; no behavior changed — only crate
visibility.

### Run it

```bash
cargo install cargo-fuzz
cargo +nightly fuzz run resolve_expression   # from src-tauri/
cargo +nightly fuzz run parse_genie
```

(Run from `src-tauri/`; cargo-fuzz finds `fuzz/` relative to the cwd.)

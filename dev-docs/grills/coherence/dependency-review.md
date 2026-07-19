# ADR-C5 Dependency Review — Coherence Layer Phase 1

> Status: **PASS** — all three additions reviewed and approved (rule 60 §4)

- **Date:** 2026-07-18
- **Plan:** `dev-docs/plans/20260718-coherence-layer.md` ADR-C5 / Risk 3
- **Prerequisite check:** Spike S2 PASS recorded (`spike-s2.md`) before any
  `Cargo.toml` change, per ADR-C1.

## 1. `rusqlite` 0.40 (features: `bundled`)

- **What:** the canonical Rust SQLite binding (github.com/rusqlite/rusqlite,
  its own GitHub org; first released 2014). One of the most-downloaded
  crates on crates.io (hundreds of millions of downloads); actively
  maintained (0.40.1 current). Not a plausible slopsquat: exact name
  verified against the org's repository and the S2 spike's resolved
  `cargo tree` (`rusqlite v0.40.1` from crates.io index).
- **Why bundled:** S2 decision — macOS system SQLite is an Apple build
  (3.51.0, OS-release-dependent, non-default compile options) and Windows
  ships no system SQLite; bundling pins 3.53.2 everywhere for ~1.2 MiB.
- **Supply-chain surface:** `bundled` compiles the vendored SQLite
  amalgamation via `cc` at build time; no runtime network, no macros
  executing at runtime. Transitive deps are the long-standing
  `libsqlite3-sys`, `hashlink`, `fallible-iterator` family.
- **Cross-target note:** builds under mingw-w64 (the pre-push
  `check:cross` gate) — libsqlite3-sys bundled mode supports
  `x86_64-pc-windows-gnu`.

## 2. `uuid` — add feature `v7` (no new crate)

- Existing pinned dependency (`uuid = "1"`, feature `v4`). UUIDv7 (spec
  §2: entry/object/writer IDs) is a feature flag on the same crate;
  `now_v7()` needs `v7` + `std` (default). Zero new packages in the
  lockfile.

## 3. `unicode-normalization` 0.1

- **What:** NFC normalization (spec §3.1) from the `unicode-rs` org — the
  same org that maintains the Unicode tables used across the Rust
  ecosystem; a dependency of rustc's own toolchain components
  historically. Tiny (one dependency: `tinyvec`), no build scripts doing
  codegen at build time (tables are pre-generated in-source), no unsafe
  I/O surface.
- **Why not hand-roll:** NFC requires the full Unicode composition tables;
  hand-rolling is the kind of "clever" this repo forbids.

## Verification

- `cargo audit` run after the manifest change — result recorded below.
- `cargo tree` inspected for unexpected transitive additions.
- Versions pinned by the existing lockfile discipline (exact versions in
  `src-tauri/Cargo.lock`, committed).

### cargo audit result (2026-07-18, cargo-audit 0.22.1, 689 crates)

Four vulnerabilities reported — **all pre-existing and unrelated to this
change**: RUSTSEC-2026-0194/0195 in `quick-xml` 0.37.5 and 0.39.4, both
reached only through `tauri 2.11.5`'s own dependency chains (plus the
long-standing gtk3-bindings unmaintained warnings on the Linux leg).
Neither `rusqlite` nor `unicode-normalization` introduces any advisory or
any `quick-xml` edge. The quick-xml upgrades are owned by
Dependabot/tauri upstream, tracked by CI's `cargo audit` job.

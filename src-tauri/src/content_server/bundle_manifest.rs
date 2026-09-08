//! The one join between `resolve_cli`'s bundled-resource lookup and the bundle
//! manifest (`tauri.conf.json` → `bundle.resources`) — WI-FL0.8.
//!
//! `spawn::resolve_cli` used to name `content-server-dist/cli.js` as a Tauri
//! resource directly, and nothing checked that anything produced or bundled it.
//! Nothing did: the v0.9.65 DMG's `Contents/Resources/resources/` holds only
//! `workflows/examples`, `bundle.resources` lists one glob
//! (`resources/workflows/**/*`), and no build step emits a `cli.js` — so every
//! packaged install fell through to the provisioned path and ended in
//! `not-found`. The lookup now goes through [`BUNDLED_CLI_RESOURCE`], and
//! `bundle_manifest.test.rs` reads the SAME constant against the manifest and
//! the disk, so the two can no longer disagree silently.

/// Path, relative to Tauri's `Resource` base directory, of the content-server
/// `cli.js` a packaged build ships — or `None` while no build step produces it.
///
/// It is `None` today because the artefact does not exist: nothing in the
/// build writes `content-server-dist/cli.js` into the bundle (verified against
/// the v0.9.65 DMG), and `server/content/tsup.config.ts` keeps the server's npm
/// dependencies external, so a lone `cli.js` could not run even if it were
/// copied. Decision D1 in `dev-docs/plans/20260907-feature-ledger-fixes.md`
/// settles whether this becomes `Some("content-server-dist/cli.js")` together
/// with a real build step (option b) or the feature stays developer-only
/// (option c). Flipping it is gated in both directions by the test: `Some(rel)`
/// requires a `bundle.resources` entry that bundles `rel` AND the source file on
/// disk; `None` forbids a stale entry that mentions the content server.
pub const BUNDLED_CLI_RESOURCE: Option<&str> = None;

#[cfg(test)]
#[path = "bundle_manifest.test.rs"]
mod bundle_manifest_test;

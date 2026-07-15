# AI browser policy matrix spike

> Status: **PASS — Rust policy matrix covered**

The matrix distinguishes human, sandbox, and shared provenance; human tabs require an
ephemeral generation-bound attachment; sandbox reads are allowed on committed pages;
shared reads require the approved destination origin; writes still require the closed
operation grant; upload is hard-denied.

Evidence: `cargo test --manifest-path src-tauri/Cargo.toml browser::` — 151 passed,
including the origin-guard mode matrix and attachment tests.

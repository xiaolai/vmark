# WI-0.2 — Spike: Tauri binary `Channel<&[u8]>` transport

> Plan: `dev-docs/plans/20260531-terminal-industrial-best.md` (ADR-T1)
> Status: **PENDING — requires a running Tauri app. Gates Phase 1.**
> Verdict: _not yet run_ (this doc must contain the literal word `PASS` on the
> verdict line for `scripts/check-terminal-phase.sh 0` to pass).
> Date created: 2026-05-31

## Hypothesis to validate

A `tauri::ipc::Channel<&[u8]>` (or `Channel<tauri::ipc::InvokeResponseBody>`)
passed into `pty_start` delivers PTY bytes to the webview as a **binary
`ArrayBuffer`** (not a JSON number array), and beats the current event path on
the WI-0.1 fixture by a wide margin.

This is spike-gated because the Tauri v2 `Channel` binary API surface is
version-sensitive (`portable-pty 0.9`, `tauri 2.x`) and there is **no existing
`Channel` precedent in this codebase** — getting the encoding wrong silently
falls back to JSON-array semantics, which would defeat the entire migration.

## Minimal probe (throwaway, do NOT ship)

Rust (a temporary command):

```rust
#[tauri::command]
async fn pty_channel_probe(on_bytes: tauri::ipc::Channel<&[u8]>) -> Result<(), String> {
    let payload: Vec<u8> = (0..=255u8).cycle().take(1024 * 1024).collect();
    on_bytes.send(&payload).map_err(|e| e.to_string())?;
    Ok(())
}
```

JS:

```ts
import { Channel, invoke } from "@tauri-apps/api/core";
const ch = new Channel<ArrayBuffer>();
ch.onmessage = (msg) => {
  // PASS criteria: msg is an ArrayBuffer / Uint8Array, NOT number[].
  console.log("type:", Object.prototype.toString.call(msg), "byteLength:", (msg as ArrayBuffer).byteLength);
};
await invoke("pty_channel_probe", { onBytes: ch });
```

## PASS / FAIL criteria

- **PASS** when: the JS `onmessage` receives binary (`ArrayBuffer`/`Uint8Array`
  with `byteLength === 1048576`), byte-identical to the source, AND a quick
  timing of N sends beats the equivalent event+JSON path materially.
- **FAIL** when: the payload arrives as `number[]` (JSON semantics), is
  truncated/corrupted, or shows no throughput advantage.

## Verdict

Machine-readable verdict line (the Phase-0 checker greps `^VERDICT: PASS`).
Change `PENDING` → `PASS` or `FAIL` after running the probe, and note the
observed type, byteLength, and timing below it.

VERDICT: PENDING

## If PASS → Phase 1 implementation notes

- `pty_start` gains a `Channel` parameter; store nothing extra (the channel is
  per-call). Reader thread calls `channel.send(&buf[..n])` instead of
  `app.emit`. This makes output **point-to-point**, closing T2 (no broadcast).
- `lib/pty.ts` constructs `new Channel<ArrayBuffer>()`, sets `onmessage` to fire
  `onData(new Uint8Array(buf))`, and passes it to the `pty_start` invoke.
- Keep `pty:exit:{pid}` as a plain event (low-frequency, simple payload).

## If FAIL → fallback

- Try `Channel<tauri::ipc::InvokeResponseBody>` with `InvokeResponseBody::Raw`.
- Failing that, a custom URI-scheme streaming response. Revise ADR-T1.

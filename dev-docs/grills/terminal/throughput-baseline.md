# WI-0.1 — PTY Transport Throughput Baseline

> Plan: `dev-docs/plans/20260531-terminal-industrial-best.md`
> Audit finding: T1 (`dev-docs/audit/20260531-terminal-integration.md`)
> Status: **In-process component measured (automated). End-to-end pending app run.**
> Date: 2026-05-31

## What this measures

The current PTY output transport (`pty.rs:265`) emits each reader chunk as a
Tauri event whose `Vec<u8>` payload is serialized as a **JSON array of numbers**
(`[27,91,49,...]`). JS receives it as `number[]` and coerces to `Uint8Array`
(`spawnPty.ts:131`). The proposed path (ADR-T1) sends raw bytes over a
`tauri::ipc::Channel<&[u8]>` → `ArrayBuffer` → `new Uint8Array(buf)`.

The bench `src/bench/terminal.bench.ts` isolates the **in-process encode/parse
component** of that difference — the part faithfully measurable without a running
app. Re-run with:

```bash
pnpm bench src/bench/terminal.bench.ts
```

## Results (2026-05-31, this machine — relative ratios are the portable signal)

### Wire-size blow-up (deterministic, machine-independent)

| Payload | Binary | JSON number array | Blow-up |
|--------:|-------:|------------------:|:-------:|
| 4 KB    | 4 KB   | ~0.01 MB          | **3.66×** |
| 256 KB  | 256 KB | ~0.92 MB          | **3.66×** |
| 1 MB    | 1 MB   | 3.66 MB           | **3.66×** |
| 10 MB   | 10 MB  | 36.6 MB           | **3.66×** |

Constant 3.66× more bytes on the IPC bridge, regardless of size. A 10 MB build
log is physically transmitted as ~36.6 MB.

### CPU cost (vitest bench, ratio = proposed ÷ current)

| Stage | Payload | Current vs proposed |
|-------|--------:|:-------------------:|
| Encode (producer) | 256 KB | **255× slower** |
| Encode (producer) | 1 MB   | **1148× slower** |
| Decode (consumer) | 4 KB   | **202× slower** |
| Decode (consumer) | 256 KB | **698× slower** |
| Decode (consumer) | 1 MB   | **783× slower** |
| Round-trip (enc+dec) | 256 KB | **2284× slower** |

## Calibration — read this before quoting the numbers

- These ratios are the **isolated encode/parse CPU**, not end-to-end terminal
  latency. The real win is bounded by the IPC bridge itself and `term.write()`,
  which the binary path also speeds up (3.66× less data to move), but the
  practical end-to-end multiple will be **large but far below 2000×**.
- The audit (§8) flagged T1's magnitude as *unverified* and estimated "5–10×".
  **That estimate was too conservative for the CPU component** — the
  encode/decode cost is 200–2000×, and the wire blow-up is a flat 3.66×. The
  audit has been updated to cite these measured figures.
- The numbers above are from one machine; treat the **ratios** as the portable
  signal, not the absolute hz.

## End-to-end measurement (PENDING — requires a running app)

The bench cannot spawn a real PTY or cross the real IPC bridge. To capture the
true user-visible baseline, run this manual flow in a dev build and record it
here:

1. Build/run the app (`pnpm tauri dev` or a release build).
2. Open the terminal panel; in the shell run a fixed large emitter, e.g.:
   ```bash
   time seq 1 2000000        # ~14 MB of output
   # or: time cat <a-10MB-log-file>
   ```
3. Record: wall-clock to drain, observable lag/stutter, and (Activity Monitor /
   `top`) the WebView process CPU spike during the drain.
4. Repeat after Phase 1 (WI-1.1) lands and compare. This before/after pair is
   the Phase-1 DoD ("WI-0.1 probe re-run shows the channel path ≥ target
   improvement").

> Alternatively, the Tauri MCP tools (`tauri_*`) can drive a running build to
> automate steps 2–3 if a driver session is set up.

_Recorded end-to-end baseline:_ _(fill after manual run)_

# Embedded Browser — Phase 0 Spikes

Runnable probes that validate the load-bearing assumptions of
`dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md` **before** any
Phase 1 product code. Governance §7 (spike-before-commit).

Each `SPIKE-N.md` ends with a `Verdict: PASS` or `Verdict: FAIL` line that
`scripts/check-browser-phase.sh 0` checks. All are currently **NOT RUN** — they
require a live Tauri session and, for some, a logged-in test account, so they are
executed by a human, not autonomously.

| Spike | Question | Blocking? |
|---|---|---|
| SPIKE-1 | Can VMark own a WKWebView as a subview AND is there provably no Tauri bridge in it? | **YES — FAIL halts the plan** |
| SPIKE-2 | Sync + async (`callAsyncJavaScript`) eval round-trip; dependency matrix compiles | no |
| SPIKE-3 | Screenshot + does NSEvent produce trusted input on a real site? | no |
| SPIKE-4 | Profile persistence across restart; isolation floor (macOS 14) | no |
| SPIKE-5 | Freeze-to-snapshot occlusion: latency, race, focus/IME | no |
| SPIKE-6 | Windows + Linux embedding; Windows isolated world | no |
| SPIKE-7 | One publishing probe (self-hosted WordPress) + CSRF/session reality | no |

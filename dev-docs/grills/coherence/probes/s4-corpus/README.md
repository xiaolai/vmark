# S4 fixture corpus — seeded-contradiction check cases

24 check cases for Spike S4 (WI-0.7, coherence-layer plan), built on the
S3 story world (`../s3-corpus/`). Each case in `cases.json`:

- `upstream` + `edit` — the OLD revision is the s3-corpus file; the NEW
  revision is OLD with the seeded edit applied (`op: replace` demands the
  exact substring exist — fixture drift fails loudly; `op: append` adds
  lines at the end).
- `scene` — the downstream scene, written against OLD by construction.
- `ground_truth` — `contradiction` (8: c01-c08), `no-contradiction`
  (12: c09-c20), `ambiguous` (4: c21-c24, arguable either way — they test
  the checker's use of "unknown"/calibration, and are excluded from the
  headline precision denominator).

Consumed by `../s4-semantic-check.mjs`; results in `../s4-results.json`
carry the raw per-case model outputs.

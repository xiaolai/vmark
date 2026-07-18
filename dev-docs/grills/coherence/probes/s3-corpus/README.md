# S3 fixture corpus — edge-inference story world

Fictional story world built for Spike S3 (WI-0.7, coherence-layer plan).
Ground truth is known **by construction**: each of the 10 scenes was
written against exactly the upstream docs listed in `ground-truth.json`.

- Upstream docs (6): `elena.md`, `marcus.md` (character sheets),
  `world-rules.md`, `guild-law.md` (world-rule docs), `timeline.md`,
  `style.md`.
- Scenes (10): `scene-01.md` … `scene-10.md`, ~150-300 words each,
  present day = Year 723.
- Difficulty mix: easy (named character + sheet facts), hard (dependency
  without naming — implicit rule use, date arithmetic), and three traps
  where a doc is mentioned or echoed with **no** semantic dependency
  (scene-04: Marcus name-drop; scene-07: Guild banners as scenery;
  scene-10: "the glassblower's daughter" as crowd scenery).
- `style.md` is contextual for every scene: all prose follows it, no
  scene depends on a fact in it.

Consumed by `../s3-edge-inference.mjs`; extended by `../s4-corpus/` for
Spike S4.

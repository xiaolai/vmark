# 35 - Copy Conventions (R14, WI-UI4.2)

The casing REGISTER comes from the key pattern, never guessed from the value.
What `scripts/check-i18n-keys.ts` (`checkCopyConventions`) actually ENFORCES
against `scripts/i18n-copy-baseline.json` (identity, ratchets down; record wins
with `pnpm lint:i18n --update-copy`): Title Case on the chrome register, the
punctuation vocabulary (`…`, `→`), and no trailing period on descriptions.
Sentence case on the running-copy register is CONVENTION ONLY — no mechanical
sentence-case test survives acronyms and proper nouns without a baseline larger
than the problem, so reviewers hold that line, not the gate. English only:
each locale follows its own conventions.

| Register | Key pattern | Casing |
|---|---|---|
| Chrome nouns | `menu.*`, `contextMenu.*`, `tabMenu.*`, `toolbar.*`, `*.title`, `*button*` | Title Case (stop words lowercase; pronouns like "My" are capped; "All"/"Each" are significant) |
| Running copy | `*.label`, `*.description`, `*.empty`, `*.placeholder`, `toast.*` | Sentence case |

Punctuation vocabulary:

- `…` never `...` (fixed repo-wide: 91 JSON values + 24 in `en.yml`).
- `→` never `->`; navigation paths read `Settings → Integrations`, never `Settings > X`.
- Descriptions carry **no trailing period** (Q3). Multi-sentence descriptions
  are the baselined remainder — reword them or revisit Q3 before adding more.
- Curly quotes around interpolations: `“{{name}}”`, never `"{{name}}"`.
- Never capitalize INSIDE an interpolation: `{{count}}` is a variable name, and
  `{{Count}}` silently renders the raw braces (caught live 2026-08-29 — and the
  placeholder-mismatch check used to fail the run WITHOUT printing why; it is
  loud now).

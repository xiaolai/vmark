---
paths:
  - "src/locales/**"
  - "src-tauri/locales/**"
---

# 35 - Copy Conventions (R14, WI-UI4.2)

The casing REGISTER comes from the key pattern, never guessed from the value.
What `scripts/check-i18n-keys.ts` (`checkCopyConventions`) actually ENFORCES
against `scripts/i18n-copy-baseline.json` (identity, ratchets down; record wins
with `pnpm lint:i18n --update-copy`): Title Case on the chrome register, the
punctuation vocabulary (`…`, `→`, spaced `—`), and no trailing period on descriptions.
Sentence case on the running-copy register is CONVENTION ONLY — no mechanical
sentence-case test survives acronyms and proper nouns without a baseline larger
than the problem, so reviewers hold that line, not the gate. English only:
each locale follows its own conventions.

| Register | Key pattern | Casing |
|---|---|---|
| Chrome nouns | `menu.*`, `contextMenu.*`, `tabMenu.*`, `toolbar.*`, `*.title`, `*button*`, `*.group` / `*.group.<name>` (section headings) | Title Case (stop words lowercase; pronouns like "My" are capped; "All"/"Each" are significant; a brand keeps its own spelling: macOS, iCloud) |
| Running copy | `*.label`, `*.description`, `*.empty`, `*.placeholder`, `toast.*` | Sentence case |

## Never in copy (zero tolerance — `lint:i18n`, `internalReferenceFindings`)

Internal identifiers are for maintainers: work items (`WI-3.4`), ADRs, issue
numbers (`#1081`), decision/rule ids (`(D4)`, `(R6)`), `OWASP`, `sign-off`,
`TODO`/`FIXME`. "HTML preview is sandboxed but pending OWASP sign-off (WI-3.4)."
shipped to every user in ten languages. Say what it means for the USER ("its
security review is still in progress"), or say nothing. Every locale is scanned,
full-width `（D4）` included, and there is no baseline. A token alone cannot tell
"(C4)" the envelope from "(C4)" the decision id, or `#123` the colour from the
issue: a legitimate match goes in `INTERNAL_REFERENCE_EXCEPTIONS` with its
reason, and an entry whose key is gone or no longer matches fails.

## Strings must stand alone — or be registered fragments

A value with no words once `{{placeholders}}` are removed — `({{line}}:{{column}})`
— is a FRAGMENT: right after "Cannot render", meaningless alone (it rendered as
a red "(6:1)" strip). Register it in `REGISTERED_FRAGMENTS`
(`scripts/check-i18n-keys.ts`) with where it appears and the FILES allowed to use
it; an unregistered wordless string fails, a registration whose key is gone fails,
and a use in any unlisted file fails (a toast, a variable, a `.ts` helper — uses
the JSX scan cannot follow). Within the listed files the JSX is scanned too: a
block whose only rendered content is `t(<fragment>)` fails — the registry alone
did not stop the "(6:1)" strip.

Punctuation vocabulary:

- `…` never `...`.
- `→` never `->`; navigation paths read `Settings → Integrations`, never `Settings > X`.
- Em-dashes are spaced: `word — word`. A doubled `——` and a dash beside CJK text follow CJK rules.
- Descriptions carry **no trailing period** (Q3). Multi-sentence descriptions
  are the baselined remainder — reword them or revisit Q3 before adding more.
- Curly quotes around interpolations: `“{{name}}”`, never `"{{name}}"`.
- Never capitalize INSIDE an interpolation: `{{count}}` is a variable name, and
  `{{Count}}` silently renders the raw braces.

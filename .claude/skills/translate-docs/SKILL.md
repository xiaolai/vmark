---
name: translate-docs
description: Translate VMark documentation and app strings to all 9 supported locales with subagent-driven audit, proofreading, and cultural polish. Use when adding or updating website pages, React locale JSON (src/locales/en/*.json), or Rust locale YAML (src-tauri/locales/en.yml) that need multi-language support.
---

# VMark Translation

Two modes share the same 9 locales, the same subagent pipeline, and the same cultural rules:

- **Docs mode** (default) — translate `website/guide/**/*.md` markdown files.
- **App string mode** (`--app`) — sync new keys across `src/locales/{locale}/*.json` (i18next) and `src-tauri/locales/{locale}.yml` (rust-i18n).

Docs mode is the original flow; App string mode was added to handle the smaller, structured strings that the app ships every day. They share Stages 2–4 (translate → audit → cultural polish) but differ in what they read, what they write, and how they protect existing content.

## When to Use

### Docs mode

- Adding a new page to `website/guide/`
- Updating an existing page that needs translation sync
- User asks to "translate", "localize", or "add language support" for website content

### App string mode (`--app`)

- New keys appear in `src/locales/en/*.json` or `src-tauri/locales/en.yml` without matching entries in other locales
- `pnpm lint:i18n` reports missing keys
- User asks to "sync locale files", "translate new i18n keys", or "propagate locale keys"

## Target Locales

| Code | Language | CJK? |
|------|----------|------|
| `zh-CN` | Simplified Chinese | Yes |
| `zh-TW` | Traditional Chinese | Yes |
| `ja` | Japanese | Yes |
| `ko` | Korean | Yes |
| `de` | German | No |
| `fr` | French | No |
| `es` | Spanish | No |
| `it` | Italian | No |
| `pt-BR` | Brazilian Portuguese | No |

## Workflow

### Step 1: Prepare Source

1. Read the English source file from `website/guide/...`
2. Identify the file path pattern (e.g., `guide/users-as-developers/foo.md`)
3. Check that all target locale directories exist: `website/{locale}/guide/...`

### Step 2: Translate (parallel subagents)

Dispatch **up to 9 translation subagents in parallel** — one per locale. Each subagent receives:

- The full English source content
- The target locale code and language name
- Translation rules (see below)

**Translation Rules for Every Locale:**

1. **Translate all prose** — headings, paragraphs, list items, block quotes, alert blocks
2. **Preserve markdown structure exactly** — headings levels, link URLs, code blocks, tables, images, front matter
3. **Keep technical terms in English** — product names (VMark, Tauri, ProseMirror, Tiptap, CodeMirror, Mermaid, Vitest), programming terms in code context (LOC, TDD, CI/CD, API, MCP), file paths, command names
4. **Translate table headers and cell text** — but keep code/numbers as-is
5. **Translate VitePress containers** — `::: info`, `::: tip`, `::: warning` labels stay as-is (VitePress renders them), but translate the content inside
6. **Adapt culturally** — don't just word-swap. Use natural phrasing. Examples:
   - "TL;DR" → "太长不看版" (zh-CN), "要約" (ja), "요약" (ko)
   - "out of the box" → use the local idiom, not a literal translation
   - Currency/number formatting: use locale conventions in prose (but keep raw numbers in tables/code)
7. **Em-dash spacing** — follow VMark convention: `word — word` with spaces in English/European locales. CJK locales use `——` (double em-dash) without spaces.

**Additional CJK Rules (zh-CN, zh-TW, ja, ko):**

8. **CJK-Latin spacing** — Always insert a space between CJK characters and Latin letters/numbers: `学习 Python 编程` not `学习Python编程`
9. **Fullwidth punctuation** — Use fullwidth comma `，`, period `。`, colon `：`, question mark `？`, exclamation `！` in CJK prose. Keep halfwidth in code/URLs.
10. **No space before fullwidth punctuation** — `你好，世界` not `你好 ，世界`
11. **zh-TW specifics** — Use Traditional Chinese characters. Use `「」` for quotes instead of `""`. Use Taiwanese terminology where it differs from mainland (e.g., 程式 not 程序, 資料 not 数据).
12. **ja specifics** — Use appropriate kanji/hiragana/katakana mix. Technical terms typically use katakana (エディタ, ファイル). Use `「」` for quotes.
13. **ko specifics** — Use Hangul for Korean words, keep English for technical terms. Use `「」` or `""` for quotes.

### Step 3: Audit & Proofread (parallel subagents)

After all translations are written, dispatch **audit subagents in parallel** — one per locale. Each subagent:

1. **Reads both** the English source AND the translated output
2. **Checks for:**
   - Missing or extra paragraphs/sections (structural drift)
   - Untranslated fragments left behind
   - Meaning drift or mistranslation
   - Broken markdown (unclosed links, malformed tables, wrong heading levels)
   - Links that should point to the locale version (e.g., `/guide/foo` → `/{locale}/guide/foo` if the site uses locale-prefixed links — note: VMark VitePress does NOT prefix internal links, so keep them as-is)
   - Grammar and fluency issues
   - CJK formatting violations (for CJK locales):
     - Missing spaces between CJK and Latin/numbers
     - Halfwidth punctuation in CJK prose
     - Spaces before fullwidth punctuation
3. **Outputs a verdict:**
   - `PASS` — no issues found
   - `FIX: [list of issues with line numbers]` — issues that need correction

If any locale gets `FIX`, apply corrections and re-run that locale's audit (max 2 retries).

### Step 4: Cultural Polish (parallel subagents, CJK only)

For CJK locales only (zh-CN, zh-TW, ja, ko), dispatch a **cultural polish subagent** that:

1. Reads the audited translation
2. Checks for "translationese" — phrasing that's grammatically correct but sounds like a translation rather than native writing
3. Adapts idioms and cultural references
4. Verifies register/tone matches the target audience (technical but approachable)
5. For zh-CN/zh-TW: ensures the text reads as natural Chinese, not English-shaped Chinese
6. For ja: ensures proper keigo level (polite but not overly formal for docs)
7. For ko: ensures proper speech level (해요체 for docs)
8. Applies final corrections

### Step 5: Write Files & Update Config

1. Write each translated file to `website/{locale}/guide/{path}`
2. Update sidebar config in `website/.vitepress/config/{locale}.ts` — add the new page entry matching the English sidebar structure
3. Build the website: `cd website && pnpm build` — verify no errors

## Subagent Prompts

### Translation Subagent

```
You are a professional translator specializing in technical documentation.
Translate the following English markdown document to {LANGUAGE} ({LOCALE_CODE}).

RULES:
{Include all rules from Step 2 above, filtered for CJK/non-CJK as appropriate}

SOURCE:
{English markdown content}

OUTPUT: The complete translated markdown file, ready to save. No commentary — just the translated document.
```

### Audit Subagent

```
You are a bilingual technical documentation auditor fluent in English and {LANGUAGE}.
Compare this translation against the English source and report issues.

ENGLISH SOURCE:
{English content}

{LANGUAGE} TRANSLATION:
{Translated content}

CHECK FOR:
1. Missing or extra sections (compare heading counts)
2. Untranslated English fragments
3. Meaning drift or mistranslation
4. Broken markdown syntax
5. Grammar and fluency
{If CJK: 6. CJK-Latin spacing (must have spaces)
7. Fullwidth punctuation in CJK prose
8. No spaces before fullwidth punctuation}

OUTPUT: Either "PASS" or "FIX:" followed by a numbered list of issues with line numbers and corrections.
```

### Cultural Polish Subagent (CJK only)

```
You are a native {LANGUAGE} technical writer. Polish this translated document
so it reads as natural {LANGUAGE}, not translated English.

DOCUMENT:
{Audited translation}

FOCUS:
- Replace "translationese" with natural phrasing
- Adapt idioms and cultural references
- Ensure consistent terminology
- Verify CJK-Latin spacing throughout
- {zh-TW: Use Traditional Chinese characters and Taiwanese terminology}
- {ja: Appropriate kanji/hiragana/katakana mix, polite register}
- {ko: Proper 해요체 speech level}

OUTPUT: The polished document, ready to save. No commentary.
```

## Notes

- Run translation subagents in parallel for speed (up to 9 concurrent)
- Run audit subagents in parallel after all translations complete
- Cultural polish only runs for CJK locales (4 subagents)
- Total subagent calls per page: 9 (translate) + 9 (audit) + 4 (polish) = 22 max
- If a translation is being updated (not new), read the existing translation first to preserve any manual edits to terminology choices

---

## App String Mode (`--app`)

Sync newly-added keys across all locale files for the React frontend (`src/locales/`) and the Rust backend (`src-tauri/locales/`).

### Target files

| Layer | English source | Target locales |
|---|---|---|
| React (i18next) | `src/locales/en/*.json` | `src/locales/{locale}/*.json` |
| Rust (rust-i18n) | `src-tauri/locales/en.yml` | `src-tauri/locales/{locale}.yml` |

### Sync semantics (non-negotiable)

1. **Additive only.** Translate keys that exist in English but are missing in a target locale. **Never retranslate existing keys** — users and prior translators may have chosen specific terminology on purpose.
2. **Exact key preservation.** Every key path in the target locale must match the English source byte-for-byte. No renaming, no reordering (YAML comments stay put; JSON key order follows the English file).
3. **Placeholder fidelity.** Preserve interpolation placeholders verbatim:
   - i18next: `{{name}}` — double-brace, lowercase names
   - rust-i18n: `%{name}` — percent-brace, lowercase names
   - Plural markers (`_one`, `_plural`) — keep the suffix in the key; translate the value appropriately.
4. **Technical tokens stay English.** Product and protocol names inside strings: `Pandoc`, `Markdown`, `VMark`, `MCP`, `YAML`, `HTML`, `PDF`, keyboard shortcuts like `Cmd+S`, file extensions like `.pdf`.
5. **Structure preservation.** JSON remains valid (2-space indent, trailing newline). YAML preserves comments and whitespace around the new block.

### Workflow

**Stage A — Detect missing keys (deterministic, no subagent)**

1. Run `pnpm lint:i18n` to see what's missing, OR
2. For a focused sync: diff a specific namespace against English.
3. Produce a per-locale list of `{keyPath, englishValue}` pairs. If no missing keys, stop — nothing to do.

**Stage B — Translate (parallel subagents, one per locale)**

Dispatch up to 9 translation subagents in parallel. Each receives:
- The locale code and language name
- The list of `{keyPath, englishValue}` pairs for that locale
- The App String Translation Rules below
- The existing locale file (read-only context) so translators can match prevailing terminology

Each subagent returns a JSON/YAML fragment containing **only the new keys** (never a full file rewrite).

**App String Translation Rules**

1. Keep placeholders (`{{name}}`, `%{name}`) byte-for-byte identical.
2. Match the register of existing translations in the same file (formal vs. casual; sentence case vs. title case).
3. UI strings are typically short — aim for a translation of similar visual weight. A 12-character English button label should not become a 40-character phrase if a shorter native equivalent exists.
4. Error messages should sound like the app talking, not a compiler. Avoid "ERROR:" prefixes unless the English source has them.
5. Title-case English strings: match the locale's convention. zh/ja/ko don't have title case — use sentence form. German nouns stay capitalized regardless.
6. Keep punctuation style consistent with the rest of that locale file:
   - CJK: fullwidth `。，：？！`
   - European: halfwidth `.,:?!`
   - French: space before `: ; ? !` per French typography
7. Preserve the ending punctuation of the English string (presence/absence). If English ends with `.`, the translation ends with `。`/`.`; if it ends without, so does the translation.

**Stage C — Audit (parallel subagents, one per locale)**

Each audit subagent checks the produced fragments:
- Every English key is present in the translated fragment.
- No keys were added beyond the requested list.
- Placeholders match (name, syntax, count).
- Translation is coherent (not machine-literal).
- CJK-specific checks apply (spacing, punctuation) — same rules as docs mode.

Verdict: `PASS` or `FIX: [issues]`. Retry up to 2 times on `FIX`.

**Stage D — Cultural polish (CJK only, parallel, one per locale)**

Same as docs mode: natural phrasing, idiomatic adjustments, consistent terminology with the rest of the locale file.

**Stage E — Write**

1. Merge the fragment into the target locale file (preserve existing keys, add new ones at the appropriate position — end of file or matching section).
2. Run `pnpm lint:i18n` — must pass.
3. For Rust: run `cargo check -q` from `src-tauri/` — must pass (verifies YAML is still parseable).
4. Commit in a single change with all 9 locales together so key coverage is atomic.

### Subagent prompts (App string mode)

**App Translation Subagent**

```
You are a professional technical translator.
Translate these application UI strings from English to {LANGUAGE} ({LOCALE_CODE}).

CONTEXT: These are UI strings for VMark, a markdown editor. The existing
{LANGUAGE} locale file has {N} existing translations — I've included it
below so you can match its style and terminology.

RULES:
1. Preserve placeholders exactly: {{name}}, %{name}
2. Keep English technical terms: Pandoc, Markdown, VMark, MCP, YAML, HTML, PDF,
   keyboard shortcuts (Cmd+S), file extensions (.pdf)
3. Match the register and punctuation style of existing entries
4. UI strings — aim for similar visual weight; don't let a button label balloon
5. {If CJK: CJK-Latin spacing; fullwidth punctuation in prose; no space before fullwidth punctuation}
6. {If zh-TW: Traditional Chinese, 「」 quotes, Taiwanese terminology}
7. {If ja: keigo polite register, 「」 quotes}
8. {If ko: 해요체 register}

EXISTING TRANSLATIONS (for style reference):
{Existing locale file content}

KEYS TO TRANSLATE (JSON):
{
  "key.path": "English value with possible {{placeholder}}",
  ...
}

OUTPUT: A JSON object with the same keys and the translated values.
No commentary.
```

**App Audit Subagent**

```
You are a bilingual auditor checking translated app strings for {LANGUAGE}.

ENGLISH KEYS:
{json of English key/value pairs}

{LANGUAGE} TRANSLATION:
{json of translated pairs}

CHECK:
1. Every English key is present in the translation
2. No extra keys
3. Placeholders match byte-for-byte (same names, same count)
4. Fluent and idiomatic
5. {If CJK: proper spacing and fullwidth punctuation}

OUTPUT: "PASS" or "FIX: [numbered issues]"
```

### Quick-run helper scripts

This repo keeps two propagation scripts that pre-fill translations for specific rounds of work. They are **not a substitute** for this skill — they're snapshots used during the initial rollout:

- `scripts/propagate-i18n-keys.mjs` — frontend JSON key propagation
- `scripts/propagate-rust-errors.mjs` — Rust YAML errors: namespace propagation

Use the skill for anything beyond the keys those scripts already know about. The scripts handle the "write" step safely (they skip keys that already exist), but they don't audit or culturally polish — that's what this skill adds.

### Verification checklist

Before declaring Stage E done:

- [ ] `pnpm lint:i18n` passes (every locale has every English key).
- [ ] `cd src-tauri && cargo check -q` passes (YAML syntax valid).
- [ ] `pnpm test` passes (no tests broke because of key renames — guards against accidental rename instead of addition).
- [ ] Spot-check one CJK locale visually for fullwidth punctuation in UI context (e.g., error toast in Japanese UI).
- [ ] Git diff shows additions only, no modifications to pre-existing keys.

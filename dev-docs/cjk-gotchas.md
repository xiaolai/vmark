# CJK Formatting Gotchas

Things that will bite you if you're not careful. Read this before modifying the CJK formatter.

## Architecture: Segment Extraction vs. Placeholders

VMark uses **segment extraction** — protected regions are identified, formattable segments are extracted, and only those segments are formatted. Protected text is never touched.

This is structurally superior to **placeholder-based** systems (e.g., Glean's Python formatter) which replace protected regions with UUID tokens, format the whole text, then restore. Placeholder systems have inherent risks:

- **Placeholder collision** — user text could contain the placeholder pattern, causing silent corruption
- **Restoration order** — nested placeholders must be restored in reverse order; forward-order restoration corrupts nested regions
- **Cross-span matching** — greedy regexes applied to the full text can match across placeholder boundaries

VMark's approach eliminates all three by design. Regression tests in `formatter.test.ts` document this.

**However**, segment extraction requires the protected region scanner (`markdownParser.ts`) to be correct. If it misses a region, that text gets formatted and potentially corrupted. The integrity verification system (`integrity.ts`) serves as a safety net: it counts structural patterns before and after formatting and discards the result if any count changes.

## Curly Quotes Are Latin Glyphs

`""` `''` (U+201C-201F) are rendered by the **Latin font**, not the CJK font. They're halfwidth characters with incorrect vertical positioning in pure CJK text. Simplified Chinese uses them by convention (GB/T 15834), but they need spacing to look acceptable:

```
中文 "引用" 中文     (with spacing)
中文"引用"中文       (without — looks cramped)
```

Corner brackets `「」『』` are fullwidth CJK glyphs and **never** need spacing. The formatter handles both via `quoteSpacing` and `singleQuoteSpacing` toggles.

## Claude Can't See the Difference

Claude (and most LLMs) treat straight `"` (U+0022), curly left `\u201c`, and curly right `\u201d` as visually identical in monospace rendering. The formatter's `smartQuoteConversion` rule converts straight to curly in CJK context — correct for published output, but creates invisible differences in source-mode diffs.

When debugging quote-related issues, use a hex viewer or `charCodeAt()` to distinguish quote types. Don't trust visual inspection.

## Fullwidth Punctuation Fires on CJK-Before, Not Both Sides

The `normalizeFullwidthPunctuation` rule converts `,` to `，` when a CJK character **precedes** the punctuation, regardless of what follows. This is correct:

```
然而,Hargittai    -> 然而，Hargittai    (CJK + comma + Latin: comma belongs to CJK sentence)
Hello,World       -> Hello,World        (Latin + comma + Latin: no conversion)
```

Earlier implementations required CJK on **both** sides, which missed mixed sentences. The current behavior matches Chinese typography conventions.

## Em-Dash + Quote Spacing Interaction

Em-dash spacing runs **before** quote spacing. Both share the same "no-space neighbor" sets:

```
——"你好"——     (no space between em-dash and opening/closing quotes)
中文 —— 内容    (space on both sides when neighbors are CJK/Latin text)
```

If you reorder these rules, the spacing can double up or disappear. The ordering in `applyRules()` is intentional and tested.

## Ordered List Markers Are Protected

The period in `1. Item` must not be converted to `1。Item`. The `isOrderedListMarker()` function walks backward from the period through digits to line-start (or newline + indentation). This protects numbered lists:

```
1. 中文内容       -> 1. 中文内容       (period preserved)
中文内容。        -> 中文内容。        (period converted to fullwidth)
```

## Technical Subspans Are Protected

Within Latin text adjacent to CJK, the `latinSpanScanner.ts` identifies seven classes of technical constructs whose punctuation must not be converted:

1. **URLs** — `http://example.com` (periods, colons, slashes)
2. **Email addresses** — `user@domain.com`
3. **Version strings** — `v1.2.3`
4. **Decimal numbers** — `3.14`
5. **Time formats** — `14:30`
6. **Thousands separators** — `1,000,000`
7. **Domain names** — `api.example.com`

Without this, `Python3.11` would become `Python3。11` in CJK context.

## Korean Is Excluded from Spacing Rules

Korean uses native word spacing and particles attach directly to preceding words:

```
VMark에는        (correct — no space before particle)
VMark 에는       (wrong — breaks Korean grammar)
```

All CJK-Latin spacing patterns use `CJK_NO_KOREAN` which excludes Hangul (U+AC00-D7AF). Korean text is detected by `containsCJK()` but spacing rules skip it.

## Indented Code Blocks and Blank Lines

The protected region scanner handles blank lines within indented code blocks correctly — a blank line continues (doesn't terminate) an indented block. The block only ends when a non-blank, non-indented line appears.

Since `collapseNewlines` only runs on formattable segments (never on protected regions), blank lines inside code blocks are always preserved. This is tested in `formatter.test.ts`.

## Surrogate Pairs in CJK Extension B-G

Characters in CJK Unified Ideographs Extension B through G (U+20000-U+2CEAF) require UTF-16 surrogate pairs. The `getLeftNeighbor()` and `getRightNeighbor()` functions in `rules.ts` combine surrogate pairs when scanning for context. The `containsCJK()` function uses Unicode script property escapes (`\p{Script=Han}`) which handle supplementary planes natively.

Test: `"𠀀"` (Extension B, U+20000) is correctly detected as CJK.

## Integrity Verification Is Defense-in-Depth

The `verifyIntegrity()` function counts seven structural patterns before and after formatting:

| Pattern | Guards |
|---------|--------|
| `[^` | Footnotes |
| `<!--` | HTML comments |
| ` ``` ` | Backtick code fences |
| `~~~` | Tilde code fences |
| `$$` | Math blocks |
| `[[` | Wiki links |
| `` ` `` | Inline code |

If any count changes, `formatMarkdown()` returns the original text and logs a warning. This catches bugs in the protected region scanner that would otherwise silently corrupt documents.

## Two-Space Hard Breaks

Trailing space removal must respect two-space hard breaks (`  \n`) when the user has `preserveLineBreaks` set. The `removeTrailingSpaces` function in `rules.ts` checks each line: if trailing spaces are exactly 2+ and the line has content, they're preserved. Single trailing spaces are always removed.

## Table Cell Formatting

Tables are detected and formatted cell-by-cell, not line-by-line. The delimiter row (`| --- | --- |`) is never modified. Pipes inside inline code (`` `a|b` ``) are not treated as cell delimiters. After formatting, any newlines introduced by rules inside a cell are stripped (safety measure).

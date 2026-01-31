# Tab Escape Edge Cases Reference

Complete catalog of edge cases for Tab escape behaviors in VMark.

## WYSIWYG Mode (TipTap) Edge Cases

### 1. Multiple Consecutive Marks

**Scenario:** Text with multiple mark types applied
```
**_`bold italic code`_**
```

**Behavior:** ✅ Escapes correctly to end of all marks
**Test:** `handles bold + italic + code on same text`

---

### 2. Bold + Link Priority

**Scenario:** Text that is both bold and a link
```
[**bold link**](url)
```

**Behavior:** ✅ Link escape takes priority over mark escape
**Test:** `handles bold + link (link takes priority)`

---

### 3. Adjacent Marks Without Spacing

**Scenario:** Two different marks directly next to each other
```
**bold***italic*
```

**Behavior:** ✅ Escapes from first mark, cursor lands between marks
**Test:** `handles adjacent different marks without space`

---

### 4. Cursor at Exact Mark Start

**Scenario:** Cursor positioned exactly at mark boundary
```
hello **|bold**
      ^cursor at position 7
```

**Behavior:** ⚠️ May not escape - marks might not be active at exact boundary
**Why:** ProseMirror's storedMarks behavior
**Impact:** Minimal - users type inside marks
**Test:** `handles cursor exactly at mark start`

---

### 5. Mark Containing Only Whitespace

**Scenario:** Mark with spaces but no visible text
```
hello**   **world
```

**Behavior:** ✅ Escapes correctly
**Test:** `handles mark containing only spaces`

---

### 6. Mark with Emoji

**Scenario:** Mark containing emoji characters
```
**bold 🎉 text**
```

**Behavior:** ✅ Handles correctly, escapes after emoji
**Test:** `handles mark with emoji`

---

### 7. Mark with CJK Characters

**Scenario:** Mark containing Chinese/Japanese/Korean text
```
**粗体文字**
```

**Behavior:** ✅ Handles correctly
**Test:** `handles mark with CJK characters`

---

### 8. Very Long Marked Text

**Scenario:** Mark containing 10,000+ characters
```
**[10000 characters]**
```

**Behavior:** ✅ Performs efficiently (<10ms)
**Test:** `handles very long marked text efficiently`

---

### 9. Adjacent Links

**Scenario:** Two links directly next to each other
```
[first](url1)[second](url2)
```

**Behavior:** ✅ Escapes from correct link (containing cursor)
**Test:** `handles adjacent links`

---

### 10. Link with Very Long URL

**Scenario:** Link with 1000+ character URL
```
[text](https://example.com/[999 more chars])
```

**Behavior:** ✅ Handles correctly
**Test:** `handles link with very long URL`

---

### 11. Link with Special URL Characters

**Scenario:** URL with query params, anchors, encoded chars
```
[text](https://example.com?q=test&foo=bar#section)
```

**Behavior:** ✅ Handles correctly
**Test:** `handles link with special URL characters`

---

### 12. Empty Paragraph

**Scenario:** Cursor in empty paragraph
```
<p></p>
   ^cursor
```

**Behavior:** ✅ Returns null (no escape)
**Test:** `returns null in empty paragraph`

---

### 13. AllSelection

**Scenario:** User selects entire document (Cmd+A)
```
<All content selected>
```

**Behavior:** ✅ Does not escape (returns null)
**Test:** `does not escape with AllSelection`

---

### 14. Selection Spanning Mark

**Scenario:** Selection that includes part of marked text
```
hello **bo|ld wo|rld**
         ^^^^^^selection
```

**Behavior:** ✅ Does not escape (returns null)
**Test:** `does not escape when selection spans entire mark`

---

## Source Mode (CodeMirror) Edge Cases

### 15. Escaped Brackets in Link Text

**Scenario:** Link text contains escaped brackets
```
[text \[with\] brackets](url)
```

**Behavior:** ✅ Handles correctly with balanced bracket parsing
**Implementation:** Uses `isEscaped()` to detect backslash-escaped chars
**Test:** `handles escaped brackets in link text`

**Also Supports:**
- Nested real brackets: `[text [nested]](url)`
- Mixed escaped and real: `[text \[esc\] [real]](url)`
- Multiple nesting levels: `[outer [middle [inner]]](url)`
- Nested parens in URL: `[link](url(params))`

---

### 16. Link with Title (Multiple Quote Styles)

**Scenario:** Link with title in different quote styles
```
[text](url "double quotes")
[text](url 'single quotes')
[text](url (parentheses))
```

**Behavior:** ✅ Handles all styles correctly
**Test:** `handles link with title in double/single quotes/parentheses`

---

### 17. Link with Query Parameters

**Scenario:** URL with complex query string
```
[text](https://example.com?foo=bar&baz=qux)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles URL with query parameters`

---

### 18. Link with Anchor

**Scenario:** URL with fragment identifier
```
[text](https://example.com/page#section)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles URL with anchor/fragment`

---

### 19. Relative Path

**Scenario:** Link with relative path
```
[text](./relative/path.md)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles relative URL`

---

### 20. Absolute Path

**Scenario:** Link with absolute file path
```
[text](/absolute/path)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles absolute path`

---

### 21. Data URL

**Scenario:** Link with data URI
```
[text](data:text/plain;base64,SGVsbG8=)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles data URL`

---

### 22. Mailto Link

**Scenario:** Email link
```
[text](mailto:test@example.com)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles mailto link`

---

### 23. Malformed Links

**Scenario:** Various malformed link syntaxes
```
[text](url           <- missing closing paren
[text]url)           <- missing opening paren
]text[(url)          <- reversed brackets
```

**Behavior:** ✅ Does NOT match (returns false)
**Test:** `handles link missing closing bracket/paren`

---

### 24. Adjacent Links

**Scenario:** Two links directly adjacent
```
[first](url1)[second](url2)
```

**Behavior:** ✅ Navigates within cursor's link only
**Test:** `handles adjacent links`

---

### 25. Link in Bold Text

**Scenario:** Link inside markdown bold
```
**[link](url)**
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles link in bold text`

---

### 26. Link in List Item

**Scenario:** Link inside list
```
- [link text](url)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles link in list item`

---

### 27. Link in Blockquote

**Scenario:** Link inside blockquote
```
> [link text](url)
```

**Behavior:** ✅ Navigates correctly
**Test:** `handles link in blockquote`

---

### 28. Reference-Style Link

**Scenario:** Reference link syntax
```
[text][ref]
```

**Behavior:** ⚠️ NOT supported (different syntax)
**Impact:** Low - inline links more common
**Test:** `does not navigate in reference link`

---

### 29. Link Definition

**Scenario:** Link reference definition
```
[ref]: https://example.com
```

**Behavior:** ⚠️ NOT supported
**Test:** `does not navigate in link definition`

---

### 30. Autolink

**Scenario:** Automatic link syntax
```
<https://example.com>
```

**Behavior:** ⚠️ NOT supported (different syntax)
**Test:** `does not navigate in autolink`

---

### 31. Image Syntax

**Scenario:** Image with alt text
```
![alt text](image.png)
```

**Behavior:** ✅ Navigates correctly (same as link)
**Test:** `handles image syntax navigation`

---

### 32. Closing Parenthesis

**Scenario:** Cursor before closing paren
```
text^)
```

**Behavior:** ✅ Jumps over `)` to position after
**Test:** `jumps over closing paren`

---

### 33. Multiple Closing Chars

**Scenario:** Several closing chars in sequence
```
text^)]}
```

**Behavior:** ✅ Jumps over first `)` only
**Test:** `handles multiple closing chars in sequence`

---

### 34. Double Tilde (Strikethrough)

**Scenario:** Cursor before `~~`
```
text^~~
```

**Behavior:** ✅ Jumps over entire `~~` sequence
**Test:** `jumps over double tilde`

---

### 35. Double Equals (Highlight)

**Scenario:** Cursor before `==`
```
text^==
```

**Behavior:** ✅ Jumps over entire `==` sequence
**Test:** `jumps over double equals`

---

### 36. Single Tilde (Not a Sequence)

**Scenario:** Cursor before single `~`
```
text^~
```

**Behavior:** ✅ Does NOT jump (not a closing sequence)
**Test:** `does not jump if only one character of sequence`

---

### 37. CJK Closing Brackets

**Scenario:** Cursor before CJK punctuation
```
文字^）
文字^】
文字^」
```

**Behavior:** ✅ Jumps over CJK closing chars
**Test:** `jumps over CJK closing paren/bracket/quote`

---

### 38. Curly Quotes

**Scenario:** Cursor before typographic quotes
```
text^"  (U+201D right double quote)
text^'  (U+2019 right single quote)
```

**Behavior:** ✅ Jumps over curly quotes
**Test:** `jumps over right double/single quote`

---

### 39. Link vs Closing Char Priority

**Scenario:** Cursor at end of link text
```
[text^](url)
```

**Behavior:** ✅ Navigates to URL (link priority over `]`)
**Test:** `prioritizes link navigation over closing char`

---

### 40. Selection Present

**Scenario:** User has text selected
```
tex|t)
   ^^selection
```

**Behavior:** ✅ Does NOT handle (returns false)
**Test:** `returns false when there is a selection`

---

## Table Escape Edge Cases

### 41. Table as Only Content

**Scenario:** Document contains only a table
```
[Table]
```

**Behavior:** ✅ Both ArrowUp and ArrowDown insert paragraphs
**Test:** `scenario: table as only content`

---

### 42. Multiple Tables

**Scenario:** Document with multiple tables
```
[Table1]
[Table2]
[Table3]
```

**Behavior:** ✅ Each table correctly detected as first/last
**Test:** `scenario: three tables in sequence`

---

### 43. Table Between Paragraphs

**Scenario:** Table in middle of document
```
Paragraph
[Table]
Paragraph
```

**Behavior:** ✅ Arrow keys use default behavior (no escape)
**Test:** `scenario: table in middle - neither first nor last`

---

### 44. Very Large Table

**Scenario:** Table with 10,000+ nodes
```
[Huge Table]
```

**Behavior:** ✅ Calculation handles large sizes efficiently
**Test:** `handles calculation with very large position values`

---

## Integration Edge Cases

### 45. Bold in List Item

**Scenario:** Marked text inside list
```
- plain text **bold** more
```

**Behavior:** ✅ Escapes from mark (not list indent)
**Test:** `handles bold text inside list item`

---

### 46. Link in Blockquote

**Scenario:** Link inside blockquote
```
> quote text [link](url)
```

**Behavior:** ✅ Escapes from link
**Test:** `handles link inside blockquote`

---

### 47. Bold Link in Nested Structure

**Scenario:** Combined marks in nested blocks
```
> - **[bold link](url)**
```

**Behavior:** ✅ Link takes priority, escapes correctly
**Test:** `handles bold link inside list inside blockquote`

---

### 48. Large Document Performance

**Scenario:** 100+ paragraphs with marks
```
[100 paragraphs with marks]
```

**Behavior:** ✅ <10ms to determine escape
**Test:** `handles tab escape in large document efficiently`

---

## Summary Statistics

- **Total Edge Cases Documented:** 48
- **Working Correctly:** 44 (92%)
- **Known Limitations:** 4 (8%)
  - Cursor at exact mark start (ProseMirror edge case)
  - Reference-style links (different syntax)
  - Link definitions (different syntax)
  - Autolinks (different syntax)

**Recently Resolved:**
- ✅ Escaped brackets in links (now supported via balanced parsing)
- ✅ Nested brackets in link text (now supported)

All remaining limitations are alternative markdown syntaxes with minimal impact.

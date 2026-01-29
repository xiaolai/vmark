# CJK Formatting Guide

VMark includes a comprehensive set of formatting rules for Chinese, Japanese, and Korean text. These tools help maintain consistent typography when mixing CJK and Latin characters.

## Quick Start

Use **Format → CJK Format Document** or press `Alt + Mod + Shift + F` to format the entire document.

To format just a selection, use `Mod + Shift + F`.

---

## Formatting Rules

### 1. CJK-Latin Spacing

Automatically adds spaces between CJK and Latin characters/numbers.

| Before | After |
|--------|-------|
| 学习Python编程 | 学习 Python 编程 |
| 共100个 | 共 100 个 |
| 使用macOS系统 | 使用 macOS 系统 |

### 2. Fullwidth Punctuation

Converts halfwidth punctuation to fullwidth in CJK context.

| Before | After |
|--------|-------|
| 你好,世界 | 你好，世界 |
| 什么? | 什么？ |
| 注意:重要 | 注意：重要 |

### 3. Fullwidth Character Conversion

Converts fullwidth letters and numbers to halfwidth.

| Before | After |
|--------|-------|
| １２３４ | 1234 |
| ＡＢＣ | ABC |

### 4. Bracket Conversion

Converts halfwidth brackets to fullwidth when surrounding CJK content.

| Before | After |
|--------|-------|
| (注意) | （注意） |
| [重点] | 【重点】 |
| (English) | (English) |

### 5. Dash Conversion

Converts double hyphens to proper CJK dashes.

| Before | After |
|--------|-------|
| 原因--结果 | 原因 —— 结果 |
| 说明--这是 | 说明 —— 这是 |

### 6. Smart Quote Conversion

VMark uses a **stack-based quote pairing algorithm** that correctly handles:

- **Apostrophes**: Contractions like `don't`, `it's`, `l'amour` are preserved
- **Possessives**: `Xiaolai's` stays as-is
- **Primes**: Measurements like `5'10"` (feet/inches) are preserved
- **Decades**: Abbreviations like `'90s` are recognized
- **CJK context detection**: Quotes around CJK content get curly/corner quotes

| Before | After |
|--------|-------|
| 他说"hello" | 他说 "hello" |
| "don't worry" | "don't worry" |
| 5'10" tall | 5'10" tall |

With corner bracket option enabled:

| Before | After |
|--------|-------|
| "中文内容" | 「中文内容」 |
| 「包含'嵌套'」 | 「包含『嵌套』」 |

### 7. Ellipsis Normalization

Standardizes ellipsis formatting.

| Before | After |
|--------|-------|
| 等等. . . | 等等... |
| 然后. . .继续 | 然后... 继续 |

### 8. Repeated Punctuation

Limits consecutive punctuation marks (configurable limit).

| Before | After (limit=1) |
|--------|-----------------|
| 太棒了！！！ | 太棒了！ |
| 真的吗？？？ | 真的吗？ |

### 9. Other Cleanup

- Multiple spaces compressed: `多个   空格` → `多个 空格`
- Trailing whitespace removed
- Slash spacing: `A / B` → `A/B`
- Currency spacing: `$ 100` → `$100`

---

## Protected Content

The following content is **not** affected by formatting:

- Code blocks (```)
- Inline code (`)
- Link URLs
- Image paths
- HTML tags
- YAML frontmatter
- Backslash-escaped punctuation (e.g., `\,` stays as `,`)

### Technical Constructs

VMark's **Latin Span Scanner** automatically detects and protects technical constructs from punctuation conversion:

| Type | Examples | Protection |
|------|----------|------------|
| URLs | `https://example.com` | All punctuation preserved |
| Emails | `user@example.com` | @ and . preserved |
| Versions | `v1.2.3`, `1.2.3.4` | Periods preserved |
| Decimals | `3.14`, `0.5` | Period preserved |
| Times | `12:30`, `1:30:00` | Colons preserved |
| Thousands | `1,000`, `1,000,000` | Commas preserved |
| Domains | `example.com` | Period preserved |

Example:

| Before | After |
|--------|-------|
| 版本v1.2.3发布 | 版本 v1.2.3 发布 |
| 访问https://example.com获取 | 访问 https://example.com 获取 |
| 温度是3.14度 | 温度是 3.14 度 |

### Backslash Escapes

Prefix any punctuation with `\` to prevent conversion:

| Input | Output |
|-------|--------|
| `价格\,很贵` | 价格,很贵 (comma stays halfwidth) |
| `测试\.内容` | 测试.内容 (period stays halfwidth) |

---

## Configuration

CJK formatting options can be configured in Settings → Language:

- Enable/disable specific rules
- Set punctuation repetition limit
- Choose quote style (standard or corner brackets)

### Contextual Quotes

When **Contextual Quotes** is enabled (default):

- Quotes around CJK content → curly quotes `""`
- Quotes around pure Latin content → straight quotes `""`

This preserves the natural appearance of English text while properly formatting CJK content.

---

## CJK Letter Spacing

VMark includes a dedicated letter spacing feature for CJK text that improves readability by adding subtle spacing between characters.

### Settings

Configure in **Settings → Editor → Typography → CJK Letter Spacing**:

| Option | Value | Description |
|--------|-------|-------------|
| Off | 0 | No letter spacing (default) |
| Subtle | 0.02em | Barely noticeable spacing |
| Light | 0.03em | Light spacing |
| Normal | 0.05em | Recommended for most use cases |
| Wide | 0.08em | More pronounced spacing |

### How It Works

- Applies letter-spacing CSS to CJK character runs
- Excludes code blocks and inline code
- Works in both WYSIWYG and exported HTML
- No effect on Latin text or numbers

### Example

Without letter spacing:
> 这是一段中文文字，没有任何字间距。

With 0.05em letter spacing:
> 这 是 一 段 中 文 文 字 ， 有 轻 微 的 字 间 距 。

The difference is subtle but improves readability, especially for longer passages.

---

## Smart Quote Styles

VMark can automatically convert straight quotes to typographically correct smart quotes. This feature works during CJK formatting and supports multiple quote styles.

### Quote Styles

| Style | Double Quotes | Single Quotes |
|-------|---------------|---------------|
| Curly | "text" | 'text' |
| Corner Brackets | 「text」 | 『text』 |
| Guillemets | «text» | ‹text› |

### Stack-Based Pairing Algorithm

VMark uses a sophisticated stack-based algorithm for quote pairing:

1. **Tokenization**: Identifies all quote characters in text
2. **Classification**: Determines if each quote is opening or closing based on context
3. **Apostrophe Detection**: Recognizes contractions (don't, it's) and preserves them
4. **Prime Detection**: Recognizes measurements (5'10") and preserves them
5. **CJK Context Detection**: Checks if quoted content involves CJK characters
6. **Orphan Cleanup**: Handles unmatched quotes gracefully

### Examples

| Before | After (Curly) |
|--------|---------------|
| "hello" | "hello" |
| 'world' | 'world' |
| it's | it's |
| don't | don't |
| 5'10" | 5'10" |
| '90s | '90s |

Apostrophes in contractions (like "it's" or "don't") are preserved correctly.

### Configuration

Enable Smart Quote Conversion in Settings → Language → CJK Formatting. You can also select your preferred quote style from the dropdown menu.

---

## CJK Corner Bracket Conversion

When **CJK Corner Quotes** is enabled, curly quotes around CJK content are automatically converted to corner brackets.

### Supported Characters

Corner bracket conversion triggers when the quoted content contains **Chinese characters** (CJK Unified Ideographs U+4E00–U+9FFF):

| Content Type | Example | Converts? |
|--------------|---------|-----------|
| Chinese | `"中文"` | ✓ `「中文」` |
| Japanese with Kanji | `"日本語"` | ✓ `「日本語」` |
| Hiragana only | `"ひらがな"` | ✗ stays as `"ひらがな"` |
| Katakana only | `"カタカナ"` | ✗ stays as `"カタカナ"` |
| Korean | `"한글"` | ✗ stays as `"한글"` |
| English | `"hello"` | ✗ stays as `"hello"` |

**Tip:** For Japanese text with only Kana, manually use corner brackets `「」` or include at least one Kanji character.

---

## Test Paragraph

Copy this unformatted text into VMark and press `Alt + Mod + Shift + F` to format:

```text
最近我在学习TypeScript和React,感觉收获很大.作为一个developer,掌握这些modern前端技术是必须的.

目前已经完成了３个projects,代码量超过１０００行.其中最复杂的是一个dashboard应用,包含了数据可视化,用户认证,还有API集成等功能.

学习过程中遇到的最大挑战是--状态管理.Redux的概念. . .说实话有点难理解.后来换成了Zustand,简单多了!

老师说"don't give up"然后继续讲"写代码要注重可读性",我觉得很有道理.

访问https://example.com/docs获取v2.0.0版本文档,价格$99.99,时间12:30开始.

项目使用的技术栈如下:

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约$２００美元购买了学习资源,包括书籍和online courses.虽然价格不便宜,但非常值得.
```

### Expected Result

After formatting, the text will look like this:

---

最近我在学习 TypeScript 和 React，感觉收获很大。作为一个 developer，掌握这些 modern 前端技术是必须的。

目前已经完成了 3 个 projects，代码量超过 1000 行。其中最复杂的是一个 dashboard 应用，包含了数据可视化，用户认证，还有 API 集成等功能。

学习过程中遇到的最大挑战是 —— 状态管理。Redux 的概念... 说实话有点难理解。后来换成了 Zustand，简单多了！

老师说 “don't give up” 然后继续讲 “写代码要注重可读性”，我觉得很有道理。

访问 https://example.com/docs 获取 v2.0.0 版本文档，价格 $99.99，时间 12:30 开始。

项目使用的技术栈如下：

- **Frontend** —— React + TypeScript
- **Backend** —— Node.js + Express
- **Database** —— PostgreSQL

总共花费大约 $200 美元购买了学习资源，包括书籍和 online courses。虽然价格不便宜，但非常值得。

---

**Changes applied:**
- CJK-Latin spacing added (学习 TypeScript)
- Fullwidth punctuation converted (，。！)
- Fullwidth numbers normalized (３→3, １０００→1000, ２００→200)
- Double hyphens converted to em-dashes (-- → ——)
- Ellipsis normalized (. . . → ...)
- Smart quotes applied, apostrophe preserved (don't)
- Technical constructs protected (https://example.com/docs, v2.0.0, $99.99, 12:30)

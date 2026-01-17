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

### 6. Quote Handling

Adds spacing around quotes. Optionally converts to corner brackets.

| Before | After |
|--------|-------|
| 他说"你好"然后 | 他说 "你好" 然后 |
| 书名"论语"推荐 | 书名 "论语" 推荐 |

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

---

## Configuration

CJK formatting options can be configured in Settings → Markdown:

- Enable/disable specific rules
- Set punctuation repetition limit
- Choose quote style (standard or corner brackets)

---

## Test Paragraph

Use this paragraph to test the formatting features:

---

最近我在学习TypeScript和React,感觉收获很大.作为一个developer,掌握这些modern前端技术是必须的.

目前已经完成了３个projects,代码量超过１０００行.其中最复杂的是一个dashboard应用,包含了数据可视化,用户认证,还有API集成等功能.

学习过程中遇到的最大挑战是--状态管理.Redux的概念. . .说实话有点难理解.后来换成了Zustand,简单多了!!!

老师说"写代码要注重可读性",我觉得很有道理.现在我写code的时候会特别注意命名规范,让variable names更加descriptive.

项目使用的技术栈如下:

- **Frontend**--React + TypeScript
- **Backend**--Node.js + Express
- **Database**--PostgreSQL

总共花费大约$２００美元购买了学习资源,包括书籍和online courses.虽然价格不便宜,但非常值得.

---

After formatting, this paragraph will have proper CJK-Latin spacing, correct punctuation, and normalized characters.

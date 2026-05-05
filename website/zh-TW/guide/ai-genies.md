# AI 精靈

AI 精靈是使用 AI 轉換文字的提示範本。選取文字、呼叫精靈，然後審閱建議的修改 — 全程無需離開編輯器。

## 快速開始

1. 在 **設定 > 整合** 中設定 AI 供應商（參見 [AI 供應商](/zh-TW/guide/ai-providers)）
2. 在編輯器中選取一些文字
3. 按 `Mod + Y` 開啟精靈選取器
4. 選擇一個精靈或輸入自由格式的提示
5. 審閱行內建議 — 接受或拒絕

## 精靈選取器

按 `Mod + Y`（或選單 **工具 > AI 精靈**）開啟聚光燈風格的覆蓋層，提供統一的輸入介面。

**搜尋與自由格式** — 開始輸入可依名稱、說明或分類篩選精靈。若無精靈符合，輸入框將變為自由格式提示欄位。

**快捷按鈕** — 當範圍為「選取」且輸入為空時，會出現常用操作的一鍵按鈕（潤稿、精簡、語法、改寫）。

**兩步驟自由格式** — 當無精靈符合時，按一次 `Enter` 查看確認提示，再按一次 `Enter` 以 AI 提示方式提交。這可防止意外提交。

**範圍循環** — 按 `Tab` 循環切換範圍：選取 → 區塊 → 文件 → 全部。

**提示歷史** — 在自由格式模式（無符合精靈）下，按 `↑`/`↓` 循環瀏覽之前的提示。按 `Ctrl + R` 開啟可搜尋的歷史下拉選單。幽靈文字以灰色顯示最近符合的提示作為提示 — 按 `Tab` 接受。

### 處理中回饋

選取精靈或提交自由格式提示後，選取器顯示行內回饋：

- **處理中** — 思考指示器，附有已用時間計數器。按 `Escape` 取消。
- **預覽** — AI 回應即時串流。使用「接受」套用或「拒絕」捨棄。
- **錯誤** — 若出現問題，顯示錯誤訊息和「重試」按鈕。

狀態列也會顯示 AI 進度 — 執行中時顯示旋轉圖示和已用時間，成功時短暫閃爍「完成」，錯誤時顯示帶有重試/關閉按鈕的錯誤指示器。當 AI 有活躍狀態時，狀態列會自動顯示，即使你之前用 `F7` 隱藏了它。

## 內建精靈

VMark 內建 13 個精靈，分為四個分類：

### 編輯

| 精靈 | 說明 | 範圍 |
|------|------|------|
| 潤稿 | 提升清晰度與流暢感 | 選取 |
| 精簡 | 讓文字更簡潔 | 選取 |
| 修正語法 | 修正語法和拼字 | 選取 |
| 簡化 | 使用更簡單的語言 | 選取 |

### 創意

| 精靈 | 說明 | 範圍 |
|------|------|------|
| 擴寫 | 將想法發展為完整散文 | 選取 |
| 改寫 | 用不同的方式表達相同的意思 | 選取 |
| 生動化 | 加入感官細節和意象 | 選取 |
| 繼續 | 從此處繼續寫作 | 區塊 |

### 結構

| 精靈 | 說明 | 範圍 |
|------|------|------|
| 摘要 | 摘要整份文件 | 文件 |
| 大綱 | 生成大綱 | 文件 |
| 標題 | 建議標題選項 | 文件 |

### 工具

| 精靈 | 說明 | 範圍 |
|------|------|------|
| 翻譯 | 翻譯為英文 | 選取 |
| 以英文改寫 | 以英文改寫文字 | 選取 |

## 範圍

每個精靈在三種範圍之一上運作：

- **選取** — 高亮的文字。若未選取任何內容，則回退到目前區塊。
- **區塊** — 游標位置的段落或區塊元素。
- **文件** — 整份文件內容。

範圍決定提取哪些文字並以 `{{content}}` 傳遞給 AI。

::: tip
若範圍為 **選取** 但未選取任何內容，精靈將對目前段落運作。
:::

## 審閱建議

精靈執行後，建議會行內顯示：

- **取代** — 原始文字帶刪除線，新文字以綠色顯示
- **插入** — 新文字以綠色顯示在來源區塊之後
- **刪除** — 原始文字帶刪除線

每個建議都有接受（勾選）和拒絕（X）按鈕。

### 鍵盤快捷鍵

| 操作 | 快捷鍵 |
|------|--------|
| 接受建議 | `Enter` |
| 拒絕建議 | `Escape` |
| 下一個建議 | `Tab` |
| 上一個建議 | `Shift + Tab` |
| 接受所有建議 | `Mod + Shift + Enter` |
| 拒絕所有建議 | `Mod + Shift + Escape` |

## 狀態列指示器

AI 生成期間，狀態列顯示旋轉星光圖示和已用時間計數器（「思考中... 3 秒」）。取消按鈕（×）可停止請求。

完成後，簡短的「完成」勾選標記會閃爍 3 秒。若發生錯誤，狀態列顯示錯誤訊息以及重試和關閉按鈕。

當 AI 有活躍狀態（執行中、錯誤或成功）時，狀態列會自動顯示，即使你用 `F7` 隱藏了它。

---

## 撰寫自訂精靈

你可以建立自己的精靈。每個精靈是一個帶有 YAML 前置資料和提示範本的單一 Markdown 檔案。

### 精靈的儲存位置

精靈儲存在應用程式資料目錄中：

| 平台 | 路徑 |
|------|------|
| macOS | `~/Library/Application Support/app.vmark/genies/` |
| Windows | `%APPDATA%\app.vmark\genies\` |
| Linux | `~/.local/share/app.vmark/genies/` |

從選單 **工具 > 開啟精靈資料夾** 開啟此資料夾。

### 目錄結構

子目錄成為選取器中的 **分類**。你可以按自己的方式組織精靈：

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← 你的自訂分類
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← 另一個自訂分類
    └── blog-intro.md
```

### 檔案格式

每個精靈檔案由兩部分組成：**前置資料**（元資料）和 **範本**（提示）。

```markdown
---
description: Improve clarity and flow
scope: selection
category: editing
---

You are an expert editor. Improve the clarity, flow, and conciseness
of the following text while preserving the author's voice and intent.

Return only the improved text — no explanations.

{{content}}
```---
description: Improve clarity and flow
scope: selection
category: editing
---

You are an expert editor. Improve the clarity, flow, and conciseness
of the following text while preserving the author's voice and intent.

Return only the improved text — no explanations.

{{content}}
```

檔案名稱 `polish.md` 在選取器中顯示為「Polish」。

### 前置資料欄位

| 欄位 | 必填 | 值 | 預設值 |
|------|------|----|--------|
| `description` | 否 | 選取器中顯示的簡短說明 | 空 |
| `scope` | 否 | `selection`、`block`、`document` | `selection` |
| `category` | 否 | 用於分組的分類名稱 | 子目錄名稱 |
| `action` | 否 | `replace`、`insert` | `replace` |
| `context` | 否 | `1`、`2` | `0`（無） |
| `model` | 否 | 覆蓋供應商預設值的模型識別符 | 供應商預設值 |

**精靈名稱** — 顯示名稱始終從 **檔案名稱**（不含 `.md`）衍生。例如，`fix-grammar.md` 在選取器中顯示為「Fix Grammar」。重新命名檔案即可變更顯示名稱。

### `{{content}}` 佔位符

`{{content}}` 佔位符是每個精靈的核心。精靈執行時，VMark：

1. 根據範圍 **提取文字**（選取的文字、目前區塊或完整文件）
2. 用提取的文字 **取代** 範本中所有的 `{{content}}`
3. 將填入的提示 **發送** 至活躍的 AI 供應商
4. 將回應以行內建議的形式 **串流** 返回

例如，使用此範本：

```markdown
Translate the following text into French.

{{content}}
```

若使用者選取「Hello, how are you?」，AI 接收：

```
Translate the following text into French.

Hello, how are you?
```

AI 回應「Bonjour, comment allez-vous ?」，並顯示為替換選取文字的行內建議。

### `{{context}}` 佔位符

`{{context}}` 佔位符提供 AI 唯讀的周圍文字 — 讓它能夠匹配附近區塊的語氣、風格和結構，同時不修改它們。

**運作原理：**

1. 在前置資料中設定 `context: 1` 或 `context: 2` 以包含 ±1 或 ±2 個相鄰區塊
2. 在範本中使用 `{{context}}` 指定要注入周圍文字的位置
3. AI 看到上下文，但建議只取代 `{{content}}`

**複合區塊是原子單位** — 若相鄰元素是清單、表格、引言或詳細資料區塊，整個結構算作一個區塊。

**範圍限制** — 上下文只在 `selection` 和 `block` 範圍中有效。對於 `document` 範圍，內容本身就已是完整文件。

**自由格式提示** — 在選取器中輸入自由格式指令時，VMark 會自動為 `selection` 和 `block` 範圍包含 ±1 個相鄰區塊作為上下文。無需設定。

**向後相容** — 沒有 `{{context}}` 的精靈與之前完全相同。若範本不包含 `{{context}}`，則不提取周圍文字。

**範例 — AI 接收的內容：**

使用 `context: 1`，游標位於三段文件的第二段：

```
[Before]
First paragraph content here.

[After]
Third paragraph content here.
```

當該方向沒有相鄰內容時（例如，內容在文件的開頭或結尾），`[Before]` 和 `[After]` 部分會被省略。

### `action` 欄位

預設情況下，精靈會用 AI 輸出 **取代** 來源文字。設定 `action: insert` 可將輸出 **附加** 在來源區塊之後。

使用 `replace` 的情境：編輯、改寫、翻譯、語法修正 — 任何轉換原始文字的操作。

使用 `insert` 的情境：繼續寫作、在內容下方生成摘要、加入注解 — 任何在不移除原始內容的情況下新增文字的操作。

**範例 — insert 操作：**

```markdown
---
description: Continue writing from here
scope: block
action: insert
---

Continue writing naturally from where the following text leaves off.
Match the author's voice, style, and tone. Write 2-3 paragraphs.

Do not repeat or summarize the existing text — just continue it.

{{content}}
```---
description: Continue writing from here
scope: block
action: insert
---

Continue writing naturally from where the following text leaves off.
Match the author's voice, style, and tone. Write 2-3 paragraphs.

Do not repeat or summarize the existing text — just continue it.

{{content}}
```

### `model` 欄位

覆蓋特定精靈的預設模型。適合對簡單任務使用較便宜的模型，對複雜任務使用更強大的模型。

```markdown
---
description: Quick grammar fix (uses fast model)
scope: selection
model: claude-haiku-4-5-20251001
---

Fix grammar and spelling errors. Return only the corrected text.

{{content}}
```---
description: Quick grammar fix (uses fast model)
scope: selection
model: claude-haiku-4-5-20251001
---

Fix grammar and spelling errors. Return only the corrected text.

{{content}}
```

模型識別符必須符合你的活躍供應商接受的格式。

## 撰寫有效提示的技巧

### 明確指定輸出格式

告訴 AI 確切要返回什麼。若不指定，模型容易新增解釋、標題或注解。

```markdown
<!-- 好 -->
Return only the improved text — no explanations.

<!-- 不好 — AI 可能用引號包裹輸出、加上「以下是改進後的版本：」等 -->
Improve this text.
```

### 設定角色

給 AI 一個角色以確立其行為方向。

```markdown
<!-- 好 -->
You are an expert technical editor who specializes in API documentation.

<!-- 尚可但較不聚焦 -->
Edit the following text.
```

### 限制範圍

告訴 AI **不要** 修改什麼。這可防止過度編輯。

```markdown
<!-- 好 -->
Fix grammar and spelling errors only.
Do not change the meaning, style, or tone.
Do not restructure sentences.

<!-- 不好 — 給 AI 太多自由 -->
Fix this text.
```

### 在提示中使用 Markdown

你可以在提示範本中使用 Markdown 格式。這在你希望 AI 生成結構化輸出時很有用。

```markdown
---
description: Generate a pros/cons analysis
scope: selection
action: insert
---

Analyze the following text and produce a brief pros/cons list.

Format as:

**Pros:**
- point 1
- point 2

**Cons:**
- point 1
- point 2

{{content}}
```---
description: Generate a pros/cons analysis
scope: selection
action: insert
---

Analyze the following text and produce a brief pros/cons list.

Format as:

**Pros:**
- point 1
- point 2

**Cons:**
- point 1
- point 2

{{content}}
```

### 保持提示聚焦

一個精靈，一件工作。不要將多個任務合併成一個精靈 — 建立獨立的精靈。

```markdown
<!-- 好 — 一個明確的工作 -->
---
description: Convert to active voice
scope: selection
---

Rewrite the following text using active voice.
Do not change the meaning.
Return only the rewritten text.

{{content}}
```---
description: Convert to active voice
scope: selection
---

Rewrite the following text using active voice.
Do not change the meaning.
Return only the rewritten text.

{{content}}
```

## 自訂精靈範例

### 學術 — 撰寫摘要

```markdown
---
description: Generate an academic abstract
scope: document
action: insert
---

Read the following paper and write a concise academic abstract
(150-250 words). Follow standard structure: background, methods,
results, conclusion.

{{content}}
```---
description: Generate an academic abstract
scope: document
action: insert
---

Read the following paper and write a concise academic abstract
(150-250 words). Follow standard structure: background, methods,
results, conclusion.

{{content}}
```

### 部落格 — 生成吸引人的開頭

```markdown
---
description: Write an engaging opening paragraph
scope: document
action: insert
---

Read the following draft and write a compelling opening paragraph
that hooks the reader. Use a question, surprising fact, or vivid
scene. Keep it under 3 sentences.

{{content}}
```---
description: Write an engaging opening paragraph
scope: document
action: insert
---

Read the following draft and write a compelling opening paragraph
that hooks the reader. Use a question, surprising fact, or vivid
scene. Keep it under 3 sentences.

{{content}}
```

### 程式碼 — 解釋程式碼區塊

```markdown
---
description: Add a plain-English explanation above code
scope: selection
action: insert
---

Read the following code and write a brief plain-English explanation
of what it does. Use 1-2 sentences. Do not include the code itself
in your response.

{{content}}
```---
description: Add a plain-English explanation above code
scope: selection
action: insert
---

Read the following code and write a brief plain-English explanation
of what it does. Use 1-2 sentences. Do not include the code itself
in your response.

{{content}}
```

### 電子郵件 — 使其更專業

```markdown
---
description: Rewrite in professional tone
scope: selection
---

Rewrite the following text in a professional, business-appropriate tone.
Keep the same meaning and key points. Remove casual language,
slang, and filler words.

Return only the rewritten text — no explanations.

{{content}}
```---
description: Rewrite in professional tone
scope: selection
---

Rewrite the following text in a professional, business-appropriate tone.
Keep the same meaning and key points. Remove casual language,
slang, and filler words.

Return only the rewritten text — no explanations.

{{content}}
```

### 翻譯 — 翻譯為繁體中文

```markdown
---
description: Translate to Traditional Chinese
scope: selection
---

Translate the following text into Traditional Chinese (繁體中文).
Preserve the original meaning, tone, and formatting.
Use natural, idiomatic Chinese — not word-for-word translation.

Return only the translated text — no explanations.

{{content}}
```---
description: Translate to Traditional Chinese
scope: selection
---

Translate the following text into Traditional Chinese (繁體中文).
Preserve the original meaning, tone, and formatting.
Use natural, idiomatic Chinese — not word-for-word translation.

Return only the translated text — no explanations.

{{content}}
```

### 情境感知 — 符合周圍風格

```markdown
---
description: Rewrite to match surrounding tone and style
scope: selection
context: 1
---

Rewrite the following content to fit naturally with its surrounding context.
Match the tone, style, and level of detail.

Return only the rewritten text — no explanations.

## Surrounding context (do not include in output):
{{context}}

## Content to rewrite:
{{content}}
```---
description: Rewrite to match surrounding tone and style
scope: selection
context: 1
---

Rewrite the following content to fit naturally with its surrounding context.
Match the tone, style, and level of detail.

Return only the rewritten text — no explanations.

## Surrounding context (do not include in output):
{{context}}

## Content to rewrite:
{{content}}
```

### 審閱 — 事實查核

```markdown
---
description: Flag claims that need verification
scope: selection
action: insert
---

Read the following text and list any factual claims that should be
verified. For each claim, note why it might need checking (e.g.,
specific numbers, dates, statistics, or strong assertions).

Format as a bullet list. If everything looks solid, say
"No claims flagged for verification."

{{content}}
```---
description: Flag claims that need verification
scope: selection
action: insert
---

Read the following text and list any factual claims that should be
verified. For each claim, note why it might need checking (e.g.,
specific numbers, dates, statistics, or strong assertions).

Format as a bullet list. If everything looks solid, say
"No claims flagged for verification."

{{content}}
```

## AI 建議

當精靈傳回的文字是用來取代選取範圍（而非自由格式聊天回覆）時，VMark 會將其呈現為帶行內差異的 **建議**：原始文字以紅色刪除線顯示，建議文字以綠色底線顯示。在任何變更實際保存之前，你需先審閱並核准。

| 操作 | 快捷鍵 |
|---|---|
| 接受目前焦點的建議 | `Tab` |
| 拒絕目前焦點的建議 | `Esc` |
| 接受文件中所有建議 | `Mod + Shift + Enter` _(情境感知 — 在表格內時亦為「在上方新增列」)_ |
| 循環至下一個建議 | 在非焦點位置時按 `Tab` |

當精靈改寫多個段落時，每個替換都是可獨立導覽的建議。接受其中一個不會自動接受其他。

建議介面也具備 MCP 介面 — 透過 [MCP 伺服器](/zh-TW/guide/mcp-tools)連線的外部 AI 代理可發出 `suggestion.accept` / `suggestion.reject` 動作來操作相同的狀態。

## 限制

- 精靈只在 **所見即所得模式** 下有效。在原始碼模式中，快顯通知會說明此限制。
- 每次只能執行一個精靈。若 AI 已在生成中，選取器不會啟動另一個。
- `{{content}}` 佔位符是字面取代 — 不支援條件式或迴圈。
- 使用 `scope: document` 時，非常大的文件可能觸及供應商的 Token 上限。

## 疑難排解

**「無可用的 AI 供應商」** — 開啟設定 > 整合並設定供應商。請參見 [AI 供應商](/zh-TW/guide/ai-providers)。

**精靈未出現在選取器中** — 檢查檔案是否有 `.md` 副檔名、有效的 `---` 圍欄前置資料，以及是否位於精靈目錄中（不能在超過一層的子目錄中）。

**AI 返回亂碼或錯誤** — 確認你的 API 金鑰正確且模型名稱對你的供應商有效。檢查終端機/主控台的錯誤詳情。

**建議不符合預期** — 精煉你的提示。加入限制（「只返回文字」、「不要解釋」）、設定角色或縮小範圍。

## 延伸閱讀

- [AI 供應商](/zh-TW/guide/ai-providers) — 設定 CLI 或 REST API 供應商
- [鍵盤快捷鍵](/zh-TW/guide/shortcuts) — 完整快捷鍵參考
- [MCP 工具](/zh-TW/guide/mcp-tools) — 透過 MCP 進行外部 AI 整合

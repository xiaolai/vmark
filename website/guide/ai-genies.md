# AI Genies

AI Genies are prompt templates that transform your text using AI. Select text, invoke a genie, and review the suggested changes — all without leaving the editor.

## Quick Start

1. Configure an AI provider in **Settings > Integrations** (see [AI Providers](/guide/ai-providers))
2. Select some text in the editor
3. Press `Mod + Y` to open the genie picker
4. Choose a genie or type a freeform prompt
5. Review the inline suggestion — accept or reject

## The Genie Picker

Press `Mod + Y` (or menu **Tools > AI Genies**) to open a spotlight-style overlay with a single unified input.

**Search & freeform** — Start typing to filter genies by name, description, or category. If no genies match, the input becomes a freeform prompt field.

**Quick Chips** — When the scope is "selection" and the input is empty, one-click buttons appear for common actions (Polish, Condense, Grammar, Rephrase).

**Two-step freeform** — When no genies match, press `Enter` once to see a confirmation hint, then `Enter` again to submit as an AI prompt. This prevents accidental submissions.

**Scope cycling** — Press `Tab` to cycle through scopes: selection → block → document → all.

**Prompt history** — In freeform mode (no matching genies), press `ArrowUp` / `ArrowDown` to cycle through previous prompts. Press `Ctrl + R` to open a searchable history dropdown. Ghost text shows the most recent matching prompt as a grayed hint — press `Tab` to accept it.

### Processing Feedback

After selecting a genie or submitting a freeform prompt, the picker shows inline feedback:

- **Processing** — A thinking indicator with elapsed time counter. Press `Escape` to cancel.
- **Preview** — The AI response streams in real-time. Use `Accept` to apply or `Reject` to discard.
- **Error** — If something goes wrong, the error message appears with a `Retry` button.

The status bar also shows AI progress — a spinning icon with elapsed time while running, a brief "Done" flash on success, or an error indicator with Retry/Dismiss buttons. The status bar auto-shows when AI has active status, even if you previously hid it with `F7`.

## Built-in Genies

VMark ships with 13 genies across four categories:

### Editing

| Genie | Description | Scope |
|-------|-------------|-------|
| Polish | Improve clarity and flow | Selection |
| Condense | Make text more concise | Selection |
| Fix Grammar | Fix grammar and spelling | Selection |
| Simplify | Use simpler language | Selection |

### Creative

| Genie | Description | Scope |
|-------|-------------|-------|
| Expand | Develop idea into fuller prose | Selection |
| Rephrase | Say the same thing differently | Selection |
| Vivid | Add sensory details and imagery | Selection |
| Continue | Continue writing from here | Block |

### Structure

| Genie | Description | Scope |
|-------|-------------|-------|
| Summarize | Summarize the document | Document |
| Outline | Generate an outline | Document |
| Headline | Suggest title options | Document |

### Tools

| Genie | Description | Scope |
|-------|-------------|-------|
| Translate | Translate to English | Selection |
| Rewrite in English | Rewrite text in English | Selection |

## Scope

Each genie operates on one of three scopes:

- **Selection** — The highlighted text. If nothing is selected, falls back to the current block.
- **Block** — The paragraph or block element at the cursor position.
- **Document** — The entire document content.

The scope determines what text is extracted and passed to the AI as `{{content}}`.

## Reviewing Suggestions

After a genie runs, the suggestion appears inline:

- **Replace** — Original text with strikethrough, new text in green
- **Insert** — New text shown in green after the source block
- **Delete** — Original text with strikethrough

Each suggestion has accept (checkmark) and reject (X) buttons.

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Accept suggestion | `Enter` |
| Reject suggestion | `Escape` |
| Next suggestion | `Tab` |
| Previous suggestion | `Shift + Tab` |
| Accept all | `Mod + Shift + Enter` |
| Reject all | `Mod + Shift + Escape` |

## Status Bar Indicator

While AI is generating, the status bar shows a spinning sparkle icon with an elapsed time counter ("Thinking... 3s"). A cancel button (×) lets you stop the request.

After completion, a brief "Done" checkmark flashes for 3 seconds. If an error occurs, the status bar shows the error message with Retry and Dismiss buttons.

The status bar auto-shows when AI has active status (running, error, or success), even if you hid it with `F7`.

---

## Writing Custom Genies

You can create your own genies. Each genie is a single Markdown file with YAML frontmatter and a prompt template.

### Where Genies Live

Genies are stored in your application data directory:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.vmark.app/genies/` |
| Windows | `%APPDATA%\com.vmark.app\genies\` |
| Linux | `~/.local/share/com.vmark.app/genies/` |

Open this folder from menu **Tools > Open Genies Folder**.

### Directory Structure

Subdirectories become **categories** in the picker. You can organize genies however you like:

```
genies/
├── editing/
│   ├── polish.md
│   ├── condense.md
│   └── fix-grammar.md
├── creative/
│   ├── expand.md
│   └── rephrase.md
├── academic/          ← your custom category
│   ├── cite.md
│   └── abstract.md
└── my-workflows/      ← another custom category
    └── blog-intro.md
```

### File Format

Every genie file has two parts: **frontmatter** (metadata) and **template** (the prompt).

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
```

The filename `polish.md` becomes the display name "Polish" in the picker.

### Frontmatter Fields

| Field | Required | Values | Default |
|-------|----------|--------|---------|
| `description` | No | Short description shown in picker | Empty |
| `scope` | No | `selection`, `block`, `document` | `selection` |
| `category` | No | Category name for grouping | Subdirectory name |
| `action` | No | `replace`, `insert` | `replace` |
| `context` | No | `1`, `2` | `0` (none) |
| `model` | No | Model identifier to override provider default | Provider default |

**Genie name** — The display name is always derived from the **filename** (without `.md`). For example, `fix-grammar.md` appears as "Fix Grammar" in the picker. Rename the file to change the display name.

### The `{{content}}` Placeholder

The `{{content}}` placeholder is the core of every genie. When a genie runs, VMark:

1. **Extracts text** based on the scope (selected text, current block, or full document)
2. **Replaces** every `{{content}}` in your template with the extracted text
3. **Sends** the filled prompt to the active AI provider
4. **Streams** the response back as an inline suggestion

For example, with this template:

```markdown
Translate the following text into French.

{{content}}
```

If the user selects "Hello, how are you?", the AI receives:

```
Translate the following text into French.

Hello, how are you?
```

The AI responds with "Bonjour, comment allez-vous ?" and it appears as an inline suggestion replacing the selected text.

### The `{{context}}` Placeholder

The `{{context}}` placeholder gives the AI read-only surrounding text — so it can match the tone, style, and structure of nearby blocks without modifying them.

**How it works:**

1. Set `context: 1` or `context: 2` in the frontmatter to include ±1 or ±2 neighboring blocks
2. Use `{{context}}` in your template where you want the surrounding text injected
3. The AI sees the context but the suggestion only replaces `{{content}}`

**Compound blocks are atomic** — if a neighbor is a list, table, blockquote, or details block, the entire structure counts as one block.

**Scope restrictions** — Context only works with `selection` and `block` scope. For `document` scope, the content already IS the full document.

**Freeform prompts** — When you type a freeform instruction in the picker, VMark automatically includes ±1 surrounding block as context for `selection` and `block` scope. No configuration needed.

**Backward compatible** — Genies without `{{context}}` work exactly as before. If the template doesn't contain `{{context}}`, no surrounding text is extracted.

**Example — what the AI receives:**

With `context: 1` and the cursor on the second paragraph of a three-paragraph document:

```
[Before]
First paragraph content here.

[After]
Third paragraph content here.
```

The `[Before]` and `[After]` sections are omitted when there are no neighbors in that direction (e.g., content is at the start or end of the document).

### The `action` Field

By default, genies **replace** the source text with the AI output. Set `action: insert` to **append** the output after the source block instead.

Use `replace` for: editing, rephrasing, translating, grammar fixes — anything that transforms the original text.

Use `insert` for: continuing writing, generating summaries below content, adding commentary — anything that adds new text without removing the original.

**Example — insert action:**

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
```

### The `model` Field

Override the default model for a specific genie. Useful when you want a cheaper model for simple tasks or a more powerful one for complex tasks.

```markdown
---
description: Quick grammar fix (uses fast model)
scope: selection
model: claude-haiku-4-5-20251001
---

Fix grammar and spelling errors. Return only the corrected text.

{{content}}
```

The model identifier must match what your active provider accepts.

## Writing Effective Prompts

### Be Specific About Output Format

Tell the AI exactly what to return. Without this, models tend to add explanations, headers, or commentary.

```markdown
<!-- Good -->
Return only the improved text — no explanations.

<!-- Bad — AI may wrap output in quotes, add "Here's the improved version:", etc. -->
Improve this text.
```

### Set a Role

Give the AI a persona to anchor its behavior.

```markdown
<!-- Good -->
You are an expert technical editor who specializes in API documentation.

<!-- Okay but less focused -->
Edit the following text.
```

### Constrain the Scope

Tell the AI what NOT to change. This prevents over-editing.

```markdown
<!-- Good -->
Fix grammar and spelling errors only.
Do not change the meaning, style, or tone.
Do not restructure sentences.

<!-- Bad — gives the AI too much freedom -->
Fix this text.
```

### Use Markdown in Prompts

You can use Markdown formatting in your prompt templates. This helps when you want the AI to produce structured output.

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
```

### Keep Prompts Focused

One genie, one job. Don't combine multiple tasks into a single genie — create separate genies instead.

```markdown
<!-- Good — one clear job -->
---
description: Convert to active voice
scope: selection
---

Rewrite the following text using active voice.
Do not change the meaning.
Return only the rewritten text.

{{content}}
```

## Example Custom Genies

### Academic — Write an Abstract

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
```

### Blog — Generate a Hook

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
```

### Code — Explain Code Block

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
```

### Email — Make Professional

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
```

### Translation — To Simplified Chinese

```markdown
---
description: Translate to Simplified Chinese
scope: selection
---

Translate the following text into Simplified Chinese.
Preserve the original meaning, tone, and formatting.
Use natural, idiomatic Chinese — not word-for-word translation.

Return only the translated text — no explanations.

{{content}}
```

### Context-Aware — Fit to Surroundings

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
```

### Review — Fact Check

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
```

## Limitations

- Genies only work in **WYSIWYG mode**. In source mode, a toast notification explains this.
- One genie can run at a time. If AI is already generating, the picker won't start another.
- The `{{content}}` placeholder is replaced literally — it doesn't support conditionals or loops.
- Very large documents may hit provider token limits when using `scope: document`.

## Troubleshooting

**"No AI provider available"** — Open Settings > Integrations and configure a provider. See [AI Providers](/guide/ai-providers).

**Genie not appearing in picker** — Check that the file has a `.md` extension, valid frontmatter with `---` fences, and is in the genies directory (not a subdirectory deeper than one level).

**AI returns garbage or errors** — Verify your API key is correct and the model name is valid for your provider. Check the terminal/console for error details.

**Suggestion doesn't match expectations** — Refine your prompt. Add constraints ("return only the text", "do not explain"), set a role, or narrow the scope.

## See Also

- [AI Providers](/guide/ai-providers) — Configure CLI or REST API providers
- [Keyboard Shortcuts](/guide/shortcuts) — Full shortcut reference
- [MCP Tools](/guide/mcp-tools) — External AI integration via MCP

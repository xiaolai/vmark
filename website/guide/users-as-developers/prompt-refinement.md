# Why Refine Prompts to English

AI coding tools work better when you give them English prompts — even if English isn’t your first language. VMark ships a hook that translates and refines your prompts automatically.

## Why English Matters for AI Coding

### LLMs Think in English

Large language models internally process all languages through a representation space that is heavily aligned with English. Research confirms this:

- **Internal language of thought**: LLMs use English-aligned intermediate representations regardless of input language ([arXiv:2502.15603](https://arxiv.org/abs/2502.15603)).
- **20%+ performance gain**: Pre-translating non-English prompts to English before sending them to the model improves output quality by 20% or more ([arXiv:2502.09331](https://arxiv.org/abs/2502.09331)).

In practice, a Chinese prompt like “把这个函数改成异步的” works — but the English equivalent “Convert this function to async” produces more precise code with fewer iterations.

### Tool Use Inherits Prompt Language

When an AI coding tool searches the web, reads documentation, or looks up API references, it uses your prompt’s language for those queries. English queries find better results because:

- Official docs, Stack Overflow, and GitHub issues are predominantly in English
- Technical search terms are more precise in English
- Code examples and error messages are almost always in English

A Chinese prompt asking about “状态管理” may search for Chinese resources, missing the canonical English documentation.

## The `::` Prompt Refinement Hook

VMark’s `.claude/hooks/refine_prompt.mjs` is a [UserPromptSubmit hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that intercepts your prompt before it reaches Claude, translates it to English, and refines it into an optimized coding prompt.

### How to Use It

Prefix your prompt with `::` or `>>`:

```
:: 把这个函数改成异步的
```

The hook:
1. Sends your text to Claude Haiku (fast, cheap) for translation and refinement
2. Blocks the original prompt from being sent
3. Copies the refined English prompt to your clipboard
4. Shows you the result

You then paste (`Cmd+V`) the refined prompt and press Enter to send it.

### Example

**Input:**
```
:: 这个组件渲染太慢了，每次父组件更新都会重新渲染，帮我优化一下
```

**Refined output (copied to clipboard):**
```
Optimize this component to prevent unnecessary re-renders when the parent component updates. Use React.memo, useMemo, or useCallback as appropriate.
```

### What It Does

The hook uses a carefully structured system prompt that gives Haiku:

- **Claude Code awareness** — knows the target tool’s capabilities (file editing, Bash, Glob/Grep, MCP tools, plan mode, subagents)
- **Project context** — loads from `.claude/hooks/project-context.txt` so Haiku knows the tech stack, conventions, and key file paths
- **Priority-ordered rules** — preserve intent first, then translate, then clarify scope, then strip filler
- **Mixed-language handling** — translates prose but keeps technical terms untranslated (`useEffect`, file paths, CLI commands)
- **Few-shot examples** — seven input/output pairs covering Chinese, vague English, mixed-language, and multi-step requests
- **Output length guidance** — 1–2 sentences for simple requests, 3–5 for complex ones

If your input is already a clear English prompt, it’s returned with minimal changes.

### Setup

The hook is pre-configured in VMark’s `.claude/settings.json`. It requires the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) which is automatically available with Claude Code.

No additional setup is needed — just use the `::` or `>>` prefix.

::: tip When to Skip It
For short commands (`go ahead`, `yes`, `continue`, `option 2`), send them without the prefix. The hook ignores these to avoid unnecessary round-trips.
:::

## Also Works for English Speakers

Even if you write in English, the `>>` prefix is useful for prompt optimization:

```
>> make the thing work better with the new API
```

Becomes:
```
Update the integration to use the new API. Fix any deprecated method calls and ensure error handling follows the updated response format.
```

The refinement adds specificity and structure that helps the AI produce better code on the first try.

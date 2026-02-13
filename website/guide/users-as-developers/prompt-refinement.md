# Why Refine Prompts to English

AI coding tools work better when you give them English prompts \u2014 even if English isn\u2019t your first language. VMark ships a hook that translates and refines your prompts automatically.

## Why English Matters for AI Coding

### LLMs Think in English

Large language models internally process all languages through a representation space that is heavily aligned with English. Research confirms this:

- **Internal language of thought**: LLMs use English-aligned intermediate representations regardless of input language ([arXiv:2502.15603](https://arxiv.org/abs/2502.15603)).
- **20%+ performance gain**: Pre-translating non-English prompts to English before sending them to the model improves output quality by 20% or more ([arXiv:2502.09331](https://arxiv.org/abs/2502.09331)).

In practice, a Chinese prompt like \u201C\u628A\u8FD9\u4E2A\u51FD\u6570\u6539\u6210\u5F02\u6B65\u7684\u201D works \u2014 but the English equivalent \u201CConvert this function to async\u201D produces more precise code with fewer iterations.

### Tool Use Inherits Prompt Language

When an AI coding tool searches the web, reads documentation, or looks up API references, it uses your prompt\u2019s language for those queries. English queries find better results because:

- Official docs, Stack Overflow, and GitHub issues are predominantly in English
- Technical search terms are more precise in English
- Code examples and error messages are almost always in English

A Chinese prompt asking about \u201C\u72B6\u6001\u7BA1\u7406\u201D may search for Chinese resources, missing the canonical English documentation.

## The `::` Prompt Refinement Hook

VMark\u2019s `.claude/hooks/refine_prompt.mjs` is a [UserPromptSubmit hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that intercepts your prompt before it reaches Claude, translates it to English, and refines it into an optimized coding prompt.

### How to Use It

Prefix your prompt with `::` or `>>`:

```
:: \u628A\u8FD9\u4E2A\u51FD\u6570\u6539\u6210\u5F02\u6B65\u7684
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
:: \u8FD9\u4E2A\u7EC4\u4EF6\u6E32\u67D3\u592A\u6162\u4E86\uFF0C\u6BCF\u6B21\u7236\u7EC4\u4EF6\u66F4\u65B0\u90FD\u4F1A\u91CD\u65B0\u6E32\u67D3\uFF0C\u5E2E\u6211\u4F18\u5316\u4E00\u4E0B
```

**Refined output (copied to clipboard):**
```
Optimize this component to prevent unnecessary re-renders when the parent component updates. Use React.memo, useMemo, or useCallback as appropriate.
```

### What It Does

The hook uses a system prompt that instructs Haiku to:

1. **Translate** non-English text into clear, natural English
2. **Preserve** the original intent exactly \u2014 never add or remove requirements
3. **Clarify** ambiguity: make implicit references explicit (file names, function names)
4. **Use imperative voice**: \u201CAdd\u2026\u201D, \u201CFix\u2026\u201D, \u201CRefactor\u2026\u201D
5. **Remove filler**: pleasantries, hedging, unnecessary words
6. **Keep it concise**: the shortest prompt that fully conveys the intent

If your input is already a clear English prompt, it\u2019s returned with minimal changes.

### Setup

The hook is pre-configured in VMark\u2019s `.claude/settings.json`. It requires the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) which is automatically available with Claude Code.

No additional setup is needed \u2014 just use the `::` or `>>` prefix.

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

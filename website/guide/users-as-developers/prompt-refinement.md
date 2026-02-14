# Why English Prompts Produce Better Code

AI coding tools work better when you give them English prompts — even if English isn’t your first language. VMark ships a hook that translates and refines your prompts automatically.

## Why English Matters for AI Coding

### LLMs Think in English

Large language models internally process all languages through a representation space that is heavily aligned with English.[^1] Pre-translating non-English prompts to English before sending them to the model measurably improves output quality.[^2]

In practice, a Chinese prompt like "把这个函数改成异步的" works — but the English equivalent "Convert this function to async" produces more precise code with fewer iterations.

### Tool Use Inherits Prompt Language

When an AI coding tool searches the web, reads documentation, or looks up API references, it uses your prompt's language for those queries. English queries find better results because:

- Official docs, Stack Overflow, and GitHub issues are predominantly in English
- Technical search terms are more precise in English
- Code examples and error messages are almost always in English

A Chinese prompt asking about "状态管理" may search for Chinese resources, missing the canonical English documentation. Multilingual benchmarks consistently show performance gaps of up to 24% between English and other languages — even well-represented ones like French or German.[^3]

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
- **Few-shot examples**[^4] — seven input/output pairs covering Chinese, vague English, mixed-language, and multi-step requests
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

The refinement adds specificity and structure that helps the AI produce better code on the first try.[^5]

[^1]: Multilingual LLMs make key decisions in a representation space closest to English, regardless of input/output language. Using a logit lens to probe internal representations, researchers found that semantically loaded words (like "water" or "sun") are selected in English before being translated into the target language. Activation steering is also more effective when computed in English. See: Schut, L., Gal, Y., & Farquhar, S. (2025). [Do Multilingual LLMs Think In English?](https://arxiv.org/abs/2502.15603). *arXiv:2502.15603*.

[^2]: Systematically pre-translating non-English prompts to English before inference improves LLM output quality across multiple tasks and languages. The researchers decompose prompts into four functional parts (instruction, context, examples, output) and show that selective translation of specific components can be more effective than translating everything. See: Watts, J., Batsuren, K., & Gurevych, I. (2025). [Beyond English: The Impact of Prompt Translation Strategies across Languages and Tasks in Multilingual LLMs](https://arxiv.org/abs/2502.09331). *arXiv:2502.09331*.

[^3]: The MMLU-ProX benchmark — 11,829 identical questions in 29 languages — found performance gaps of up to 24.3% between English and low-resource languages. Even well-represented languages like French and German show measurable degradation. The gap correlates strongly with the proportion of each language in the model's pre-training corpus, and simply scaling model size does not eliminate it. See: [MMLU-ProX: A Multilingual Benchmark for Advanced LLM Evaluation](https://mmluprox.github.io/) (2024); Palta, S. & Rudinger, R. (2024). [Language Ranker: A Metric for Quantifying LLM Performance Across High and Low-Resource Languages](https://arxiv.org/abs/2404.11553).

[^4]: Few-shot prompting — providing input/output examples within the prompt — dramatically improves LLM task performance. The landmark GPT-3 paper showed that while zero-shot performance improves steadily with model size, few-shot performance increases *more rapidly*, sometimes reaching competitiveness with fine-tuned models. Larger models are more proficient at learning from in-context examples. See: Brown, T., Mann, B., Ryder, N., et al. (2020). [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165). *NeurIPS 2020*.

[^5]: Structured, well-engineered prompts consistently outperform vague instructions across code generation tasks. Techniques like chain-of-thought reasoning, role assignment, and explicit scope constraints all improve first-pass accuracy. See: Sahoo, P., Singh, A.K., Saha, S., et al. (2025). [Unleashing the Potential of Prompt Engineering for Large Language Models](https://www.sciencedirect.com/science/article/pii/S2666389925001084). *Patterns*.

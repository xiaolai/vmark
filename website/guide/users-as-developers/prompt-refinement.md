# Why English Prompts Produce Better Code

AI coding tools work better when you give them English prompts — even if English isn't your first language. The [claude-english-buddy](https://github.com/xiaolai/claude-english-buddy-for-claude) plugin auto-corrects, translates, and refines your prompts automatically.

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

## The `claude-english-buddy` Plugin

`claude-english-buddy` is a Claude Code plugin that intercepts every prompt and processes it through one of four modes:

| Mode | Trigger | What Happens |
|------|---------|--------------|
| **Correct** | English prompt with errors | Fixes spelling/grammar, shows what changed |
| **Translate** | Non-English detected (CJK, Cyrillic, etc.) | Translates to English, shows translation |
| **Refine** | `::` prefix | Rewrites vague input into a precise, structured prompt |
| **Skip** | Short text, commands, URLs, code | Passes through unchanged |

The plugin uses Claude Haiku for corrections — fast and cheap, with zero interruption to your workflow.

### Auto-Correction (Default)

Just type normally. The plugin detects language automatically:

```text
You type:    "refactor the autentication modul, its got too many responsibilties"

You see:     Refactor the authentication module. It has too many responsibilities.
             (autentication>authentication; modul>module; its got>it has;
              responsibilties>responsibilities)

Claude sees: the corrected version and responds normally.
```

When your prompt is clean — silence. No noise. Silence means correct.

### Translation

Non-English prompts are automatically translated:

```text
You type:    这个组件渲染太慢了，每次父组件更新都会重新渲染，帮我优化一下

You see:     Optimize this component to prevent unnecessary re-renders when
             the parent component updates.
             (Chinese)

Claude sees: the English translation.
```

### Prompt Refinement with `::`

Prefix your prompt with `::` to refine a rough idea into a precise prompt:

```text
:: make the search faster it's really slow with big files
```

Becomes:

```text
Optimize the search implementation for large files. Profile the current
bottleneck and consider debouncing, web workers, or incremental matching.
```

The `::` prefix works for any language — it translates and restructures in one step.[^4]

::: tip When the Plugin Stays Silent
Short commands (`yes`, `continue`, `option 2`), slash commands, URLs, and code snippets are passed through unchanged. No unnecessary round-trips.
:::

## Tracking Your Progress

The plugin logs every correction. Over weeks, you can see your English improving:

| Command | What It Shows |
|---------|---------------|
| `/claude-english-buddy:today` | Today's corrections, recurring mistakes, lessons, trend |
| `/claude-english-buddy:stats` | Long-term error rate and improvement trajectory |
| `/claude-english-buddy:mistakes` | All-time recurring patterns — your blind spots |

## Setup

Install the plugin in Claude Code:

```bash
/plugin marketplace add xiaolai/claude-plugin-marketplace
/plugin install claude-english-buddy@xiaolai
```

No additional configuration needed — auto-correction starts immediately.

### Optional Configuration

Create `.claude-english-buddy.json` in your project root to customize:

```json
{
  "auto_correct": true,
  "summary_language": "Chinese",
  "strictness": "standard",
  "domain_terms": ["ProseMirror", "Tiptap", "Zustand"]
}
```

| Setting | Options | Default |
|---------|---------|---------|
| `auto_correct` | `true` / `false` | `true` |
| `strictness` | `gentle`, `standard`, `strict` | `standard` |
| `summary_language` | Any language name, or `null` to disable | `null` |
| `domain_terms` | Array of terms to preserve unchanged | `[]` |

When `summary_language` is set, Claude appends a brief summary in that language at the end of every response — useful when you want key decisions in your native language.[^5]

[^1]: Multilingual LLMs make key decisions in a representation space closest to English, regardless of input/output language. Using a logit lens to probe internal representations, researchers found that semantically loaded words (like "water" or "sun") are selected in English before being translated into the target language. Activation steering is also more effective when computed in English. See: Schut, L., Gal, Y., & Farquhar, S. (2025). [Do Multilingual LLMs Think In English?](https://arxiv.org/abs/2502.15603). *arXiv:2502.15603*.

[^2]: Systematically pre-translating non-English prompts to English before inference improves LLM output quality across multiple tasks and languages. The researchers decompose prompts into four functional parts (instruction, context, examples, output) and show that selective translation of specific components can be more effective than translating everything. See: Watts, J., Batsuren, K., & Gurevych, I. (2025). [Beyond English: The Impact of Prompt Translation Strategies across Languages and Tasks in Multilingual LLMs](https://arxiv.org/abs/2502.09331). *arXiv:2502.09331*.

[^3]: The MMLU-ProX benchmark — 11,829 identical questions in 29 languages — found performance gaps of up to 24.3% between English and low-resource languages. Even well-represented languages like French and German show measurable degradation. The gap correlates strongly with the proportion of each language in the model's pre-training corpus, and simply scaling model size does not eliminate it. See: [MMLU-ProX: A Multilingual Benchmark for Advanced LLM Evaluation](https://mmluprox.github.io/) (2024); Palta, S. & Rudinger, R. (2024). [Language Ranker: A Metric for Quantifying LLM Performance Across High and Low-Resource Languages](https://arxiv.org/abs/2404.11553).

[^4]: Few-shot prompting — providing input/output examples within the prompt — dramatically improves LLM task performance. The landmark GPT-3 paper showed that while zero-shot performance improves steadily with model size, few-shot performance increases *more rapidly*, sometimes reaching competitiveness with fine-tuned models. Larger models are more proficient at learning from in-context examples. See: Brown, T., Mann, B., Ryder, N., et al. (2020). [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165). *NeurIPS 2020*.

[^5]: Structured, well-engineered prompts consistently outperform vague instructions across code generation tasks. Techniques like chain-of-thought reasoning, role assignment, and explicit scope constraints all improve first-pass accuracy. See: Sahoo, P., Singh, A.K., Saha, S., et al. (2025). [Unleashing the Potential of Prompt Engineering for Large Language Models](https://www.sciencedirect.com/science/article/pii/S2666389925001084). *Patterns*.

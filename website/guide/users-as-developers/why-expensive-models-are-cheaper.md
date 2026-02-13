# Why Expensive Models Are Cheaper

The most expensive AI coding model is almost always the cheapest option — when you measure what actually matters. The per-token price is a distraction. What determines your real cost is **how many tokens it takes to get the job done**, how many iterations you burn through, and how much of your time goes to reviewing and fixing the output.

## The Pricing Illusion

Here are the API prices for Claude models:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Claude Opus 4.5 | $5 | $25 |
| Claude Sonnet 4.5 | $3 | $15 |

Opus looks 67% more expensive. Most people stop here and pick Sonnet. That's the wrong math.

### What Actually Happens

Anthropic's benchmarks tell a different story. At medium effort, Opus 4.5 **matches** Sonnet 4.5's best SWE-bench score while using **76% fewer output tokens**. At highest effort, Opus **exceeds** Sonnet by 4.3 percentage points while using **48% fewer tokens**.[^1]

Let's do the real math:

| | Sonnet 4.5 | Opus 4.5 |
|--|-----------|----------|
| Output tokens per task | ~500 | ~120 |
| Price per 1M output tokens | $15 | $25 |
| **Cost per task** | **$0.0075** | **$0.0030** |

Opus is **60% cheaper per task** — despite costing 67% more per token.[^2]

This isn't a cherry-picked example. On long-horizon coding tasks, Opus achieves higher pass rates while using **up to 65% fewer tokens** and making **50% fewer tool calls**.[^1]

## The Iteration Tax

Token cost is only part of the story. The bigger cost is **iterations** — how many rounds of generate-review-fix it takes to get correct code.

Opus 4.5 reaches peak performance in **4 iterations**. Competing models require **up to 10 attempts** to achieve similar quality.[^1] Each failed iteration costs you:

- **Tokens** — the model reads context and generates again
- **Time** — you review the output, find the problem, re-prompt
- **Attention** — context-switching between "is this right?" and "what's wrong?"

At a developer rate of $75/hour, each failed iteration that takes 15 minutes to review and correct costs **$18.75** in human time. Six extra iterations (the gap between 4 and 10) costs **$112.50** in developer time — per complex task. The token cost difference? About half a cent.[^3]

**Developer time savings are 22,500x the token cost difference.**

## The Error Multiplier

Cheaper models don't just take more iterations — they produce more errors that survive into production.

Opus 4.5 shows a **50–75% reduction** in both tool calling errors and build/lint errors compared to other models.[^1] This matters because errors that escape the coding session become dramatically more expensive downstream:

- A bug caught during coding costs minutes to fix
- A bug caught in code review costs an hour (yours + the reviewer's)
- A bug caught in production costs days (debugging, hotfixing, communicating, post-mortem)

The Faros AI study — covering 1,255 teams and 10,000+ developers — found that high AI adoption correlated with a **9% increase in bugs per developer** and a **91% increase in PR review time**.[^4] When AI generates more code at lower accuracy, the review bottleneck absorbs the "productivity" gains entirely.

A model that gets it right on the first pass avoids this cascade.

## The SWE-bench Evidence

SWE-bench Verified is the industry standard for evaluating AI coding ability on real-world software engineering tasks. The February 2026 leaderboard:[^5]

| Model | SWE-bench Verified |
|-------|-------------------|
| Claude Opus 4.5 | **80.9%** |
| Claude Opus 4.6 | 80.8% |
| GPT-5.2 | 80.0% |
| Gemini 3 Flash | 78.0% |
| Claude Sonnet 4.5 | 77.2% |
| Gemini 3 Pro | 76.2% |

A 3.7-point gap between Opus 4.5 and Sonnet 4.5 means Opus solves **roughly 1 in 27 additional tasks** that Sonnet fails. When each of those failures triggers a manual debugging session, the cost compounds fast.

But here's the real kicker — when researchers measured **cost per solved task** rather than cost per token, Opus was cheaper than Sonnet:

| Model | Cost Per Task | SWE-bench Score |
|-------|--------------|-----------------|
| Claude Opus 4.5 | ~$0.44 | 80.9% |
| Claude Sonnet 4.5 | ~$0.50 | 77.2% |

Sonnet costs **more per task** while solving **fewer tasks**.[^6]

## Codex CLI: Same Pattern, Different Vendor

OpenAI's Codex CLI shows the same dynamic with reasoning effort levels:

- **Medium reasoning**: Balanced speed and intelligence — the default
- **Extra-high (xhigh) reasoning**: Thinks longer, produces better answers — recommended for difficult tasks

GPT-5.1-Codex-Max with medium effort outperforms standard GPT-5.1-Codex at the same effort while using **30% fewer thinking tokens**.[^7] The premium model is more token-efficient because it reasons better — it doesn't need to generate as many intermediate steps to reach the right answer.

The pattern is universal across vendors: **smarter models waste less compute.**

## The METR Warning

The METR randomized controlled trial provides a crucial cautionary tale. Sixteen experienced developers ($150/hour) were given 246 tasks with AI tools. The result: developers were **19% slower** with AI assistance. Even more striking — developers *believed* they were 20% faster, a perception gap of nearly 39 percentage points.[^8]

The study used **Sonnet-class models** (Claude 3.5/3.7 Sonnet via Cursor Pro), not Opus. Less than 44% of AI-generated code was accepted.

This suggests that the quality threshold matters enormously. A model that produces code you accept 44% of the time makes you slower — you spend more time reviewing and rejecting than you save. A model with 50–75% fewer errors and dramatically higher first-pass accuracy could flip this equation entirely.

**The METR study doesn't show that AI coding tools are slow. It shows that mediocre AI coding tools are slow.**

## Technical Debt: The 75% You're Not Counting

The upfront cost of writing code is only **15–25% of total software cost** over its lifecycle. The remaining **75–85%** goes to maintenance, operations, and bug fixes.[^9]

GitClear's analysis of code produced during 2020–2024 found an **8x increase in duplicated code blocks** and a **2x increase in code churn** correlating with AI tool adoption. SonarSource found a **93% increase in BLOCKER-level bugs** when comparing Claude Sonnet 4 output to its predecessor.[^10]

If a cheaper model generates code with nearly double the severe bug rate, and maintenance consumes 75–85% of lifecycle cost, the "savings" on code generation are dwarfed by downstream costs. The cheapest code to maintain is code that was correct the first time.

## Subscription Math

For heavy users, the subscription vs. API choice amplifies the model-quality argument even further.

| Plan | Monthly Cost | What You Get |
|------|-------------|--------------|
| Claude Max ($100) | $100 | High Opus usage |
| Claude Max ($200) | $200 | Unlimited Opus |
| Equivalent API usage | $3,650+ | Same Opus tokens |

The subscription is roughly **18x cheaper** than API billing for the same work.[^11] At the subscription price, there is zero marginal cost to using the best model — the "expensive" model becomes literally free per additional query.

Average Claude Code cost on subscription: **$6 per developer per day**, with 90% of users below $12/day.[^12] At $75/hour developer salary, **5 minutes of saved time per day** pays for the subscription. Everything beyond that is pure return.

## The Compound Argument

Here's why the math gets even more lopsided over time:

### 1. Fewer iterations = less context pollution

Each failed attempt adds to the conversation history. Long conversations degrade model performance — the signal-to-noise ratio drops. A model that succeeds in 4 iterations has a cleaner context than one that flounders for 10, which means its later responses are also better.

### 2. Fewer errors = less review fatigue

The GitHub Copilot productivity studies found that benefits increase with task difficulty.[^13] Hard tasks are where cheap models fail most — and where expensive models shine. The ZoomInfo case study showed a **40–50% productivity boost** with AI, with the gap widening as complexity increased.

### 3. Better code = better learning

If you're a developer growing your skills (and every developer should be), the code you read shapes your instincts. Reading consistently correct, well-structured AI output teaches good patterns. Reading buggy, verbose output teaches bad habits.

### 4. Correct code ships faster

Every iteration you don't need is a feature that ships sooner. In competitive markets, development speed — measured in features delivered, not tokens generated — is what matters.

## The Decision Framework

| If you... | Use... | Why |
|-----------|--------|-----|
| Code for hours daily | Opus + subscription | Zero marginal cost, highest quality |
| Work on complex tasks | Extra-high / Opus | Fewer iterations, fewer bugs |
| Maintain long-lived code | The best model available | Technical debt is the real cost |
| Have a limited budget | Still Opus via subscription | $200/mo < cost of debugging cheap output |
| Run quick one-off queries | Sonnet / medium effort | Quality threshold matters less for simple tasks |

The only scenario where cheaper models win is for **trivial tasks where any model succeeds on the first try**. For everything else — which is most of real software engineering — the expensive model is the cheap choice.

## The Bottom Line

Per-token pricing is vanity metric. Per-task cost is the real metric. And per-task, the most capable model consistently wins — not by a small margin, but by multiples:

- **60% cheaper** per task (fewer tokens)
- **60% fewer** iterations to peak performance
- **50–75% fewer** errors
- **22,500x** more valuable in developer time savings than token cost difference

The most expensive model isn't a luxury. It's the minimum viable choice for anyone who values their time.

[^1]: Anthropic (2025). [Introducing Claude Opus 4.5](https://www.anthropic.com/news/claude-opus-4-5). Key findings: at medium effort, Opus 4.5 matches Sonnet 4.5's best SWE-bench score using 76% fewer output tokens; at highest effort, Opus exceeds Sonnet by 4.3 percentage points using 48% fewer tokens; 50–75% reduction in tool calling and build/lint errors; peak performance reached in 4 iterations vs. up to 10 for competitors.

[^2]: claudefa.st (2025). [Claude Opus 4.5: 67% Cheaper, 76% Fewer Tokens](https://claudefa.st/blog/models/claude-opus-4-5). Analysis showing that the per-token price premium is more than offset by dramatically lower token consumption per task, making Opus the more cost-effective choice for most workloads.

[^3]: Developer salary data from Glassdoor (2025): average US software developer salary $121,264–$172,049/year. At $75/hour, 15 minutes of review/correction per failed iteration = $18.75 in human time. Six extra iterations (gap between 4 and 10) = $112.50 per complex task. See: [Glassdoor Software Developer Salary](https://www.glassdoor.com/Salaries/software-developer-salary-SRCH_KO0,18.htm).

[^4]: Faros AI (2025). [The AI Productivity Paradox](https://www.faros.ai/blog/ai-software-engineering). Study of 1,255 teams and 10,000+ developers found: individual developers on high-AI teams complete 21% more tasks and merge 98% more PRs, but PR review time increased 91%, bugs increased 9% per developer, and PR size grew 154%. No significant correlation between AI adoption and company-level performance improvements.

[^5]: SWE-bench Verified Leaderboard, February 2026. Aggregated from [marc0.dev](https://www.marc0.dev/en/leaderboard), [llm-stats.com](https://llm-stats.com/benchmarks/swe-bench-verified), and [The Unwind AI](https://www.theunwindai.com/p/claude-opus-4-5-scores-80-9-on-swe-bench). Claude Opus 4.5 was the first model to break 80% on SWE-bench Verified.

[^6]: JetBrains AI Blog (2026). [The Best AI Models for Coding: Accuracy, Integration, and Developer Fit](https://blog.jetbrains.com/ai/2026/02/the-best-ai-models-for-coding-accuracy-integration-and-developer-fit/). Cost-per-task analysis across multiple models, incorporating token consumption and success rates. See also: [AI Coding Benchmarks](https://failingfast.io/ai-coding-guide/benchmarks/) at Failing Fast.

[^7]: OpenAI (2025). [GPT-5.1-Codex-Max](https://openai.com/index/gpt-5-1-codex-max/); [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide/). Codex-Max with medium reasoning effort outperforms standard Codex at the same effort while using 30% fewer thinking tokens — the premium model is inherently more token-efficient.

[^8]: METR (2025). [Measuring the Impact of Early 2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/). Randomized controlled trial: 16 experienced developers, 246 tasks, $150/hour compensation. AI-assisted developers were 19% slower. Developers expected 24% speedup and believed post-hoc they were 20% faster — a perception gap of ~39 percentage points. Less than 44% of AI-generated code was accepted. See also: [arXiv:2507.09089](https://arxiv.org/abs/2507.09089).

[^9]: Industry data on software lifecycle costs consistently places maintenance at 60–80% of total cost. See: Sommerville, I. (2015). *Software Engineering*, 10th ed., Chapter 9: "The costs of changing software after release typically far exceed initial development costs." See also: [MIT Sloan: The Hidden Costs of Coding with Generative AI](https://sloanreview.mit.edu/article/the-hidden-costs-of-coding-with-generative-ai/).

[^10]: GitClear (2024). [AI Code Quality Analysis](https://leaddev.com/technical-direction/how-ai-generated-code-accelerates-technical-debt): 8x increase in duplicated code blocks, 2x increase in code churn (2020–2024). SonarSource (2025): analysis of AI-generated code found systemic lack of security awareness across every model tested, with Claude Sonnet 4 producing nearly double the proportion of BLOCKER-level bugs — a 93% increase in severe bug introduction rate. See: [DevOps.com: AI in Software Development](https://devops.com/ai-in-software-development-productivity-at-the-cost-of-code-quality-2/).

[^11]: Level Up Coding (2025). [Claude API vs Subscription Cost Analysis](https://levelup.gitconnected.com/why-i-stopped-paying-api-bills-and-saved-36x-on-claude-the-math-will-shock-you-46454323346c). Comparison of subscription vs. API billing showing subscriptions are roughly 18x cheaper for sustained coding sessions.

[^12]: The CAIO (2025). [Claude Code Pricing Guide](https://www.thecaio.ai/blog/claude-code-pricing-guide). Average Claude Code cost: $6 per developer per day, with 90% of users below $12/day on subscription plans.

[^13]: Peng, S. et al. (2023). [The Impact of AI on Developer Productivity: Evidence from GitHub Copilot](https://arxiv.org/abs/2302.06590). Lab study: developers completed tasks 55.8% faster with Copilot. See also: ZoomInfo case study showing 40–50% productivity boost with AI, with the gap growing as task difficulty increases ([arXiv:2501.13282](https://arxiv.org/html/2501.13282v1)).

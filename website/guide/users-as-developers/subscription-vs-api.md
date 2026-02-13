# Subscription vs API Pricing

AI coding tools offer two authentication methods: **subscription plans** and **API keys**. For sustained coding sessions (vibe-coding), subscriptions are dramatically cheaper — often 10–30x less than API billing for the same work.[^1]

## The Cost Difference

A typical active coding session uses hundreds of thousands of tokens per hour. Here’s how the costs compare:

### Claude Code

| Method | Cost | What You Get |
|--------|------|-------------|
| **Claude Max** (subscription) | $100–200/mo | Unlimited use during coding sessions |
| **API key** (`ANTHROPIC_API_KEY`) | $600–2,000+/mo | Pay per token; heavy use adds up fast |

**Auth command:**
```bash
claude          # Auto-login with Claude Max subscription (recommended)
```

### Codex CLI (OpenAI)

| Method | Cost | What You Get |
|--------|------|-------------|
| **ChatGPT Plus** (subscription) | $20/mo | Moderate use |
| **ChatGPT Pro** (subscription) | $200/mo | Heavy use |
| **API key** (`OPENAI_API_KEY`) | $200–1,000+/mo | Pay per token |

**Auth command:**
```bash
codex login     # Log in with ChatGPT subscription (recommended)
```

### Gemini CLI (Google)

| Method | Cost | What You Get |
|--------|------|-------------|
| **Free tier** | $0 | Generous free quota |
| **Google One AI Premium** | ~$20/mo | Higher limits |
| **API key** (`GEMINI_API_KEY`) | Variable | Pay per token |

**Auth command:**
```bash
gemini          # Log in with Google account (recommended)
```

## Rule of Thumb

> **Subscription = 10–30x cheaper** for sustained coding sessions.

The math is simple: a subscription gives you a flat monthly rate, while API billing charges per token. AI coding tools are extremely token-hungry — they read entire files, generate long code blocks, and iterate through multiple rounds of edits. A single complex feature can consume millions of tokens.[^2]

## When API Keys Still Make Sense

API keys are the right choice for:

| Use Case | Why |
|----------|-----|
| **CI/CD pipelines** | Automated jobs that run briefly and infrequently |
| **Light or occasional use** | A few queries per week |
| **Programmatic access** | Scripts and integrations that call the API directly |
| **Team/org billing** | Centralized billing through API usage dashboards |

For interactive coding sessions — where you're going back and forth with the AI for hours — subscriptions win on cost every time.[^3]

## Setup in VMark

VMark’s `AGENTS.md` enforces subscription-first auth as a project convention. When you clone the repo and open an AI coding tool, it reminds you to use subscription auth:

```
Prefer subscription auth over API keys for all AI coding tools.
```

All three tools work out of the box once authenticated:

```bash
# Recommended: subscription auth
claude              # Claude Code with Claude Max
codex login         # Codex CLI with ChatGPT Plus/Pro
gemini              # Gemini CLI with Google account

# Fallback: API keys
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AI...
```

::: tip PATH for macOS GUI Apps
macOS GUI apps (like terminals launched from Spotlight) have a minimal PATH. If a tool works in your terminal but Claude Code can't find it, ensure the binary location is in your shell profile (`~/.zshrc` or `~/.bashrc`).
:::

[^1]: A typical intensive AI coding session consumes 50,000–100,000+ tokens per interaction. At current API rates (e.g., Claude Sonnet at $3/$15 per million input/output tokens), heavy users report monthly API costs of $200–$2,000+ — while subscription plans cap at $100–$200/month for unlimited use. The disparity grows with usage intensity: light users may see similar costs either way, but sustained vibe-coding sessions make subscriptions the clear winner. See: [AI Development Tools Pricing Analysis](https://vladimirsiedykh.com/blog/ai-development-tools-pricing-analysis-claude-copilot-cursor-comparison-2025) (2025); [Claude Code Token Limits Guide](https://www.faros.ai/blog/claude-code-token-limits), Faros AI (2025).

[^2]: AI coding agents consume far more tokens than simple chat interactions because they read entire files into context, generate multi-file edits, run iterative fix-test loops, and maintain conversation history across long sessions. A single complex feature implementation can involve dozens of tool calls, each consuming thousands of tokens. The context window itself becomes a cost driver — larger windows enable better results but multiply token usage. See: [The Real Cost of Vibe Coding](https://smarterarticles.co.uk/the-real-cost-of-vibe-coding-when-ai-over-delivers-on-your-dime) (2025).

[^3]: The broader SaaS industry has been moving toward hybrid pricing models that combine flat subscriptions with usage-based components. By 2023, 46% of SaaS businesses had adopted usage-based pricing, and companies using it report 137% net dollar retention. However, for AI-powered tools where every query consumes noticeable compute, pure usage-based pricing exposes users to unpredictable costs — which is why flat-rate subscriptions remain attractive for heavy individual users. See: [The State of SaaS Pricing Strategy](https://www.invespcro.com/blog/saas-pricing/) (2025); [The Evolution of Pricing Models for SaaS Companies](https://medium.com/bcgontech/the-evolution-of-pricing-models-for-saas-companies-6d017101d733), BCG (2024).

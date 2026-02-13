# Subscription vs API Pricing

AI coding tools offer two authentication methods: **subscription plans** and **API keys**. For sustained coding sessions (vibe-coding), subscriptions are dramatically cheaper — often 10–30x less than API billing for the same work.

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

The math is simple: a subscription gives you a flat monthly rate, while API billing charges per token. AI coding tools are extremely token-hungry — they read entire files, generate long code blocks, and iterate through multiple rounds of edits. A single complex feature can consume millions of tokens.

## When API Keys Still Make Sense

API keys are the right choice for:

| Use Case | Why |
|----------|-----|
| **CI/CD pipelines** | Automated jobs that run briefly and infrequently |
| **Light or occasional use** | A few queries per week |
| **Programmatic access** | Scripts and integrations that call the API directly |
| **Team/org billing** | Centralized billing through API usage dashboards |

For interactive coding sessions — where you’re going back and forth with the AI for hours — subscriptions win on cost every time.

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
macOS GUI apps (like terminals launched from Spotlight) have a minimal PATH. If a tool works in your terminal but Claude Code can’t find it, ensure the binary location is in your shell profile (`~/.zshrc` or `~/.bashrc`).
:::

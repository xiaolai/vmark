# What Are Indispensable

You don't need a computer science degree to build software with AI coding tools. But you do need a small set of skills that no AI can replace. These are the indispensable foundations — the things that make everything else possible.

## The Short List

| Skill | Why It's Indispensable |
|-------|----------------------|
| **Git** | Your safety net — undo anything, branch fearlessly, never lose work |
| **TDD** | The methodology that keeps AI-generated code honest |
| **Terminal literacy** | AI tools live in the terminal; you need to read their output |
| **English** | Docs, errors, and AI prompts all work best in English |
| **Taste** | AI generates options; you decide which one is right |

That's it. Five things. Everything else — language syntax, framework APIs, design patterns — the AI handles for you.[^1]

## Git — Your Safety Net

Git is the single most important tool in your arsenal. Not because you need to master rebasing or cherry-picking — the AI handles that — but because Git gives you **fearless experimentation**.[^2]

### What You Actually Need to Know

| Command | What It Does | When You Use It |
|---------|-------------|----------------|
| `git status` | Shows what's changed | Before and after every AI session |
| `git diff` | Shows exact changes | Review what the AI wrote before committing |
| `git add` + `git commit` | Save a checkpoint | After every working state |
| `git log` | History of changes | When you need to understand what happened |
| `git stash` | Temporarily shelve changes | When you want to try a different approach |
| `git checkout -- file` | Undo changes to a file | When the AI made something worse |
| `git worktree` | Work on multiple branches simultaneously | When you want to explore ideas in parallel |

### The Mental Model

Think of Git as **infinite undo**. Every commit is a save point you can return to. This means:

- **Try risky changes freely** — you can always go back
- **Let the AI experiment** — if it breaks something, roll back
- **Work on multiple ideas** — branches let you explore in parallel
- **Review before accepting** — `git diff` shows you exactly what the AI changed

The AI will create commits, branches, and pull requests for you. But you should understand what these are, because you're the one deciding when to save, when to branch, and when to merge.

### Git Worktrees — Parallel Universes

One Git feature worth learning early is **worktrees**. A worktree lets you check out a different branch in a separate directory — without switching your current work:

```bash
# Create a worktree for a new feature
git worktree add ../my-feature -b feature/new-idea

# Work in it
cd ../my-feature
claude    # start an AI session in this branch

# Back to your main work — untouched
cd ../vmark
```

This is especially powerful with AI coding tools: you can have one AI session experimenting on a feature branch while your main branch stays clean and working. If the experiment fails, just delete the worktree directory. No mess, no risk.

::: warning Don't Skip Git
Without Git, a single bad AI edit can ruin hours of work with no way back. With Git, the worst case is always `git checkout -- .` and you're back to your last save. Learn Git basics before anything else.
:::

## TDD — How You Keep AI Honest

Test-Driven Development is the methodology that turns AI coding from "hope it works" into "prove it works." It's not just a nice practice — it's your primary mechanism for **verifying** that AI-generated code actually does what you asked.[^3]

### The RED-GREEN-REFACTOR Cycle

TDD follows a strict three-step loop:

```
1. RED     — Write a test that describes what you want. It fails.
2. GREEN   — Ask the AI to write the minimum code to pass the test.
3. REFACTOR — Clean up without changing behavior. Tests still pass.
```

This works remarkably well with AI coding tools because:

| Step | Your Role | AI's Role |
|------|-----------|-----------|
| RED | Describe the expected behavior | Help write the test assertion |
| GREEN | Verify the test passes | Write the implementation |
| REFACTOR | Judge if the code is clean enough | Do the cleanup |

### Why TDD Matters More with AI

When you write code yourself, you understand it implicitly — you know what it does because you wrote it. When AI writes code, you need an **external verification mechanism**. Tests are that mechanism.[^4]

Without tests, here's what happens:

1. You ask the AI to add a feature
2. The AI writes 200 lines of code
3. You read it, it *looks* right
4. You ship it
5. It breaks something you didn't notice — a subtle edge case, a type mismatch, an off-by-one error

With TDD:

1. You describe the behavior as a test (the AI helps you write it)
2. The test fails — confirming it's testing something real
3. The AI writes code to make it pass
4. You run the test — it passes
5. You have **proof** it works, not just a feeling

### What a Test Looks Like

You don't need to write tests from scratch. Describe what you want in plain language, and the AI writes the test. But you should be able to **read** a test:

```ts
// "When the user saves a document, the modified flag should clear"
it("clears modified flag after save", () => {
  // Setup: mark document as modified
  store.markModified("doc-1");
  expect(store.isModified("doc-1")).toBe(true);

  // Action: save the document
  store.save("doc-1");

  // Verify: modified flag is cleared
  expect(store.isModified("doc-1")).toBe(false);
});
```

The pattern is always the same: **setup**, **action**, **verify**. Once you recognize this pattern, you can read any test — and more importantly, you can tell the AI what to test next.

### Edge Cases — Where Bugs Live

The real power of TDD is in **edge cases** — the unusual inputs and boundary conditions where bugs hide. AI is surprisingly bad at thinking of these on its own.[^5] But you can prompt it:

> "What happens if the file name is empty?"
> "What if the user double-clicks the save button?"
> "What if the network drops in the middle of a request?"
> "What about a file with Unicode characters in the name?"

Each of these becomes a test. Each test becomes a guarantee. The more edge cases you think of, the more robust your software becomes. This is where human **taste** and AI **implementation speed** combine to produce something neither could achieve alone.

### TDD in Practice with AI

Here's a real workflow:

```
You:   Add a function that checks if a filename is valid.
       Start with a failing test.

AI:    [Writes test] it("rejects empty filenames", () => { ... })
       [Test fails — RED ✓]

You:   Now make it pass.

AI:    [Writes isValidFilename()]
       [Test passes — GREEN ✓]

You:   Add tests for: spaces only, path separators,
       names longer than 255 chars, null bytes.

AI:    [Writes 4 more tests, some fail]
       [Updates function to handle all cases]
       [All tests pass — GREEN ✓]

You:   Good. Refactor if needed.

AI:    [Simplifies the regex, keeps tests passing — REFACTOR ✓]
```

You didn't write a single line of code. But you drove every decision. The tests prove the code works. And if someone changes the function later, the tests catch regressions.

::: tip The Coverage Ratchet
VMark enforces test coverage thresholds — if coverage drops below the floor, the build fails. This means every new feature *must* have tests. The AI knows this and writes tests automatically, but you should verify they test meaningful behavior, not just lines of code.
:::

## Terminal Literacy

AI coding tools are command-line programs. Claude Code, Codex CLI, Gemini CLI — they all run in a terminal. You don't need to memorize hundreds of commands, but you need to be comfortable with a handful:

```bash
cd ~/projects/vmark      # Navigate to a directory
ls                        # List files
git status                # See what's changed
git log --oneline -5      # Recent commits
pnpm install              # Install dependencies
pnpm test                 # Run tests
```

The AI will suggest and run commands for you. Your job is to **read the output** and understand whether things succeeded or failed. A test failure looks different from a build error. A permission denied is different from a file not found. You don't need to fix these yourself — but you need to describe what you see so the AI can fix it.

::: tip Start Here
If you've never used a terminal, start with [The Missing Semester](https://missing.csail.mit.edu/) from MIT — specifically the first lecture on shell tools. One hour of practice gives you enough to work with AI coding tools.
:::

## English Proficiency

This isn't about writing perfect prose. It's about **reading comprehension** — understanding error messages, documentation, and AI explanations. The entire software ecosystem runs on English:[^6]

- **Error messages** are in English
- **Documentation** is written in English first (and often only)
- **Stack Overflow**, GitHub issues, and tutorials are overwhelmingly English
- **AI models perform measurably better** with English prompts (see [Prompt Refinement](/guide/users-as-developers/prompt-refinement))

You don't need to write fluently. You need to:

1. **Read** an error message and understand the gist
2. **Search** for technical terms effectively
3. **Describe** what you want to the AI clearly enough

If English isn't your first language, VMark's `::` prompt hook translates and refines your prompts automatically. But reading the AI's responses — which are in English — is something you'll do constantly.

## Taste — The One Thing AI Can't Replace

This is the hardest to define and the most important. **Taste** is knowing what good looks like — even if you can't build it yourself yet.[^7]

When the AI offers you three approaches to solve a problem, taste is what tells you:

- The simple one is better than the clever one
- The solution with fewer dependencies is preferable
- The code that reads like prose beats "optimized" code
- A 10-line function is suspicious if 5 lines would do

### How to Develop Taste

1. **Use good software** — notice what feels right and what feels clunky
2. **Read good code** — browse popular open-source projects on GitHub
3. **Read the output** — when the AI generates code, read it even if you can't write it
4. **Ask "why"** — when the AI makes a choice, ask it to explain the trade-offs
5. **Iterate** — if something feels wrong, it probably is. Ask the AI to try again

Taste compounds. The more code you read (even AI-generated code), the better your instincts become. After a few months of AI-assisted development, you'll catch problems the AI misses — not because you know more syntax, but because you know what the **result should feel like**.

::: tip The Taste Test
After the AI finishes a task, ask yourself: "If I were a user, would this feel right?" If the answer isn't an immediate yes, tell the AI what feels off. You don't need to know the fix — just the feeling.
:::

## What You Don't Need

Just as important as knowing the essentials is knowing what you can safely skip:

| You Don't Need | Because |
|----------------|---------|
| Programming language mastery | AI writes the code; you review it |
| Framework expertise | AI knows React, Rails, Django better than most humans |
| Algorithm knowledge | AI implements algorithms; you describe the goal |
| DevOps skills | AI writes CI configs, Docker files, deployment scripts |
| Design patterns memorized | AI applies the right pattern when you describe the behavior |
| Years of experience | Fresh perspective + AI > experience without AI[^8] |

This doesn't mean these skills are worthless — they make you faster and more effective. But they're not **prerequisites** anymore. You can learn them gradually, on the job, with the AI teaching you as you go.

## The Compound Effect

These five skills — Git, TDD, terminal, English, and taste — don't just add up. They **compound**.[^9]

- Git safety lets you experiment freely, which develops taste faster
- TDD gives you confidence in AI output, so you can move faster
- Terminal fluency lets you run tests and Git commands without friction
- English comprehension lets you read error messages and documentation
- Taste makes your prompts more precise, which produces better code
- Better code gives you better examples to learn from

After a few weeks of AI-assisted development, you'll find yourself understanding things you never formally studied. That's the compound effect at work — and it's why these five foundations, and only these five, are truly indispensable.

[^1]: The "no-code" and "low-code" movements have been trying to remove programming barriers for years. AI coding tools achieve this more effectively because they don't constrain what you can build — they write arbitrary code in any language, following any pattern, based on natural language descriptions. See: Jiang, E. et al. (2022). [Discovering the Syntax and Strategies of Natural Language Programming with Generative Language Models](https://dl.acm.org/doi/10.1145/3491102.3501870). *CHI 2022*.

[^2]: Git's branching model fundamentally changes how people approach experimentation. Research on developer workflows shows that teams using frequent, small commits with branches are significantly more likely to try risky changes — because the cost of failure drops to near zero. See: Bird, C. et al. (2009). [Does Distributed Development Affect Software Quality?](https://dl.acm.org/doi/10.1145/1555001.1555040). *ICSE 2009*.

[^3]: Test-Driven Development was formalized by Kent Beck in 2002 and has since become a cornerstone of professional software engineering. The discipline of writing tests first forces developers to clarify requirements before implementation — a benefit that becomes even more powerful when the "developer" is an AI that needs precise instructions. See: Beck, K. (2002). [Test-Driven Development: By Example](https://www.oreilly.com/library/view/test-driven-development/0321146530/). Addison-Wesley.

[^4]: Studies on AI code generation consistently find that AI-generated code passes functional tests at lower rates than human-written code unless guided by explicit test cases. Providing test cases in the prompt increases correct code generation by 20–40%. See: Chen, M. et al. (2021). [Evaluating Large Language Models Trained on Code](https://arxiv.org/abs/2107.03374). *arXiv:2107.03374*; Austin, J. et al. (2021). [Program Synthesis with Large Language Models](https://arxiv.org/abs/2108.07732). *arXiv:2108.07732*.

[^5]: AI models systematically underperform on edge cases and boundary conditions. They tend to generate "happy path" code that handles common inputs but fails on unusual ones. This is a documented limitation of transformer-based code generation — the training data is biased toward typical usage patterns. See: Pearce, H. et al. (2022). [Examining Zero-Shot Vulnerability Repair with Large Language Models](https://arxiv.org/abs/2112.02125). *IEEE S&P 2022*.

[^6]: English dominates programming and technical documentation by an overwhelming margin. Analysis of GitHub's public repositories shows that over 90% of README files and code comments are in English. Similarly, Stack Overflow's 23 million questions are predominantly English. See: Casalnuovo, C. et al. (2015). [Developer Onboarding in GitHub](https://dl.acm.org/doi/10.1145/2786805.2786854). *ESEC/FSE 2015*.

[^7]: "Taste" in software engineering — the ability to distinguish good design from bad — is increasingly recognized as a core skill. Fred Brooks wrote that "great designs come from great designers," not great processes. With AI handling the mechanical aspects of coding, this aesthetic judgment becomes the primary human contribution. See: Brooks, F. (2010). [The Design of Design](https://www.oreilly.com/library/view/the-design-of/9780321702081/). Addison-Wesley.

[^8]: Studies on AI-assisted programming show that developers with less experience often benefit more from AI tools than experts — because the gap between "can describe" and "can implement" shrinks dramatically with AI assistance. See: Peng, S. et al. (2023). [The Impact of AI on Developer Productivity](https://arxiv.org/abs/2302.06590). *arXiv:2302.06590*.

[^9]: The concept of "compound learning" — where foundational skills accelerate the acquisition of related skills — is well-established in educational research. In programming specifically, understanding a few core ideas unlocks rapid learning of everything built on top of them. See: Sorva, J. (2012). [Visual Program Simulation in Introductory Programming Education](https://aaltodoc.aalto.fi/handle/123456789/3534). Aalto University.

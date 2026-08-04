# 10 - TDD Workflow

Test-Driven Development is structurally enforced in VMark. Coverage thresholds in `vitest.config.ts` make `pnpm check:all` fail if coverage drops — writing code without tests breaks the gate.

## Core Discipline: RED → GREEN → REFACTOR

1. **RED** — Write a failing test that describes the expected behavior.
2. **GREEN** — Write the minimum code to make the test pass.
3. **REFACTOR** — Clean up without changing behavior. Tests must still pass.

Never skip RED. If you write code first, you don't know your test actually catches regressions.

## When Tests Are Required

| Category | Required? | Examples |
|----------|-----------|---------|
| Stores | **ALWAYS** | State transitions, selectors, persistence |
| Hooks | **ALWAYS** | Side effects, event handling, lifecycle |
| Utils / helpers | **ALWAYS** | Pure functions, parsers, formatters |
| Rust commands | **ALWAYS** | Input validation, error paths |
| Business logic | **ALWAYS** | Close decisions, save logic, merge rules |
| Bug fixes | **ALWAYS** | Regression test proving the fix |
| Edge cases | **ALWAYS** | Empty input, null, boundary values |
| CSS-only changes | No | Visual QA with reference doc instead |
| Docs / config | No | Markdown, JSON, TOML changes |
| Type-only changes | No | Interface/type additions with no runtime effect |
| Components | Case-by-case | Test behavior (clicks, ARIA), not rendering |
| Plugins (ProseMirror) | Case-by-case | Test logic (transforms, state), not PM integration |

## Pattern Catalog

Five patterns covering the most common test types in VMark. Use these as templates.

### 1. Store Tests — `src/stores/__tests__/revisionStore.test.ts`

```ts
import { useRevisionStore } from "../revisionStore";

beforeEach(() => {
  // Reset store between tests — isolation is critical
  useRevisionStore.setState({ revisions: {} });
});

it("tracks revision for document", () => {
  const { addRevision } = useRevisionStore.getState();
  addRevision("doc-1", "content-v1");
  const rev = useRevisionStore.getState().revisions["doc-1"];
  expect(rev).toBeDefined();
});
```

**Key patterns:**
- Use `getState()` to call actions — no React rendering needed.
- Reset state in `beforeEach` to isolate tests.
- Test state transitions, not implementation details.

### 2. Plugin Tests — `src/plugins/multiCursor/__tests__/multiCursorPlugin.test.ts`

```ts
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createState(text: string) {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
  });
}

it("creates additional cursor at offset", () => {
  const state = createState("hello world");
  // ... test plugin logic using state
});
```

**Key patterns:**
- Minimal schema — only the nodes your test needs.
- Helper `createState()` function for readable tests.
- Test transaction effects, not DOM output.

### 3. Hook Tests — `src/hooks/useUnifiedMenuCommands.test.tsx`

```tsx
import { renderHook } from "@testing-library/react";
import { useUnifiedMenuCommands } from "./useUnifiedMenuCommands";

const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

it("registers menu event listeners", () => {
  renderHook(() => useUnifiedMenuCommands());
  expect(mockListen).toHaveBeenCalledWith(
    expect.stringMatching(/^menu:/),
    expect.any(Function)
  );
});
```

**Key patterns:**
- Mock external dependencies (Tauri, DOM APIs).
- Use `renderHook` — no need for a full component.
- Test that effects register/cleanup correctly.

### 4. Component Tests — `src/components/Editor/UniversalToolbar/UniversalToolbar.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("toggles bold on button click", async () => {
  const user = userEvent.setup();
  render(<UniversalToolbar />);
  const boldBtn = screen.getByRole("button", { name: /bold/i });
  await user.click(boldBtn);
  expect(boldBtn).toHaveAttribute("aria-pressed", "true");
});
```

**Key patterns:**
- Query by ARIA role/name — not CSS class or test-id.
- Use `userEvent` (not `fireEvent`) for realistic interaction.
- Test behavior (click → state change), not rendering details.
- Use `vi.hoisted()` when mock setup needs to run before imports.

### 5. Utils Tests — `src/utils/closeDecision.test.ts`

```ts
import { decideOnClose } from "./closeDecision";

describe("decideOnClose", () => {
  it.each([
    { dirty: false, hotExit: true,  expected: "close" },
    { dirty: true,  hotExit: true,  expected: "close" },
    { dirty: true,  hotExit: false, expected: "prompt" },
    { dirty: false, hotExit: false, expected: "close" },
  ])("dirty=$dirty, hotExit=$hotExit → $expected", ({ dirty, hotExit, expected }) => {
    expect(decideOnClose(dirty, hotExit)).toBe(expected);
  });
});
```

**Key patterns:**
- Table-driven tests with `it.each` — exhaustive, readable.
- Pure functions = no mocking needed.
- Cover all branches in one `describe` block.

## Anti-Patterns — What NOT to Do

| Anti-pattern | Why it's wrong | Do this instead |
|-------------|----------------|-----------------|
| Write code first, tests after | You can't verify your test catches regressions | RED first — always |
| `it("renders without crashing")` | Tests nothing meaningful | Test specific behavior or output |
| Testing implementation details | Breaks on refactor | Test observable behavior (state, output, DOM) |
| Mocking everything | Tests prove nothing | Mock boundaries (APIs, filesystem), not logic |
| Skipping edge cases | Bugs live at boundaries | Empty input, null, max values, concurrent access |
| Snapshot tests for logic | Brittle, auto-updated without review | Use explicit assertions |
| `any` in test types | Hides type errors | Use proper types even in tests |

## Coverage Check

Coverage IS enforced: `vitest.config.ts` carries ratchet-only floors (measured actuals minus a
~0.05 pp flake buffer; relaxing requires written justification in the commit message), and
`pnpm test:coverage` — which runs inside `pnpm check:all` and therefore in CI's `frontend`
check — fails when coverage drops below them. `vitest.config.ts` is the single authority for the
numbers (pinned by `src/test/coverageThresholdSources.test.ts`).

**To check locally:** `pnpm test:coverage` — then `coverage/index.html` for per-file gaps.

## Test Utilities

| File | Purpose |
|------|---------|
| `src/test/setup.ts` | Global test setup (jsdom, mocks for Tauri APIs) |
| `src/test/popupTestUtils.ts` | Helpers for testing popup positioning and behavior |

## Running Tests

```bash
pnpm test              # Run all tests once
pnpm test:watch        # Watch mode during development
pnpm test:coverage     # Run with coverage + threshold check
pnpm check:all         # Full gate (lint + coverage + build)
```

## File Placement

- Tests go next to the source: `foo.test.ts` beside `foo.ts`
- Larger test suites use `__tests__/` subdirectory
- Shared test helpers go in `src/test/`

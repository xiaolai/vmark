// WI-AL2.4 — the review panel, the comments panel (WI-AL3.2) and the two-windows pair view stay out of the cold-start bundle: the status-bar history button and the revision list reach them only through dynamic imports (a static value import from anywhere in the history popover's static closure fails), and a chunk that fails to load shows a local message whose retry loads a fresh attempt
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LazyCommentsPanel, LazyConcurrentPairDiffs, LazyReviewPanel } from "../lazyHistoryParts";

const SRC = join(import.meta.dirname, "../../..");
const HISTORY = join(SRC, "components/McpHistory");
/** The popover's own modules: everything in the folder except the lazily loaded part and its helpers. */
const LAZY_ONLY = new Set(["ConcurrentPairDiffs.tsx", "useConcurrentPair.ts", "pairDiffView.ts"]);
const statics = readdirSync(HISTORY)
  .filter((f) => /\.tsx?$/.test(f) && !LAZY_ONLY.has(f))
  .map((f) => join(HISTORY, f))
  .concat(join(SRC, "components/StatusBar/StatusBarRight.tsx"));

/** Static value imports (type-only imports are erased and do not count). */
const valueImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);

describe("lazy history parts", () => {
  it("no module in the popover's static closure value-imports the review panel, the comments panel or the pair view", () => {
    const offenders = statics.flatMap((f) =>
      valueImports(f)
        .filter((spec) => /components\/(?:ReviewPanel|Comments)\/|\/ConcurrentPairDiffs$/.test(spec))
        .map((spec) => `${f.slice(SRC.length + 1)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("a review panel chunk that fails shows a local message, and retry loads a fresh attempt", async () => {
    let calls = 0;
    const load = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("Failed to fetch dynamically imported module"))
        : Promise.resolve({ default: () => <div data-testid="panel">loaded</div> });
    };
    render(<LazyReviewPanel load={load} tabId="t" docKey="k" history={null} onChanged={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This part of the history could not be loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("panel")).toHaveTextContent("loaded");
    expect(calls).toBe(2);
  });

  it("the pair view loads through its own lazy wrapper with the props it was given", async () => {
    const load = () => Promise.resolve({ default: ({ revision }: { docKey: string; revision: string }) => <div data-testid="pair">{revision}</div> });
    render(<LazyConcurrentPairDiffs load={load} docKey="k" revision="r7" />);
    expect(await screen.findByTestId("pair")).toHaveTextContent("r7");
  });

  it("the comments panel loads through its own lazy wrapper with the props it was given", async () => {
    const load = () => Promise.resolve({ default: ({ docKey }: { tabId: string; docKey: string }) => <div data-testid="comments">{docKey}</div> });
    render(<LazyCommentsPanel load={load} tabId="t" docKey="path:/c.md" />);
    expect(await screen.findByTestId("comments")).toHaveTextContent("path:/c.md");
  });
});

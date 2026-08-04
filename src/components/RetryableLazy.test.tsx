/**
 * Audit 20260804-F3/F4 — a lazy chunk that fails must stay local and recover.
 *
 * Two properties, both of which were missing at the two call sites this
 * component was extracted for:
 *   1. CONTAINMENT — the rejection is caught here, not by whatever boundary
 *      happens to be above (the KB graph's was the ROOT one).
 *   2. RECOVERY — retry mounts a FRESH `React.lazy`. React.lazy memoizes the
 *      rejected promise, so a retry that reuses the lazy object replays the
 *      same failure forever; a test that only asserts "a retry button appears"
 *      would pass against the broken version.
 *
 * Mock boundary: NONE. `load` is a parameter, so the failure is injected
 * through the component's own contract rather than a mocked module.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetryableLazy } from "./RetryableLazy";

function Loaded({ label }: { label: string }) {
  return <div data-testid="loaded">{label}</div>;
}

/** A thunk that rejects `failures` times, then resolves. */
function flakyLoad(failures: number) {
  let remaining = failures;
  const calls = { count: 0 };
  const load = () => {
    calls.count += 1;
    if (remaining > 0) {
      remaining -= 1;
      return Promise.reject(new Error("Failed to fetch dynamically imported module"));
    }
    return Promise.resolve({ default: Loaded });
  };
  return { load, calls };
}

function renderSubject(load: () => Promise<{ default: typeof Loaded }>) {
  return render(
    <RetryableLazy
      feature="Test chunk"
      load={load}
      componentProps={{ label: "chunk content" }}
      pending={<div data-testid="pending" />}
      renderError={(retry) => (
        <div role="alert">
          <span>could not load</span>
          <button type="button" onClick={retry}>
            try again
          </button>
        </div>
      )}
    />,
  );
}

describe("RetryableLazy", () => {
  it("renders the loaded component on the happy path", async () => {
    const { load } = flakyLoad(0);
    renderSubject(load);
    expect(await screen.findByTestId("loaded")).toHaveTextContent("chunk content");
  });

  it("shows the pending placeholder while the chunk is in flight", () => {
    renderSubject(() => new Promise(() => {}));
    expect(screen.getByTestId("pending")).toBeTruthy();
  });

  it("catches a rejected chunk locally instead of rethrowing", async () => {
    const { load } = flakyLoad(1);
    renderSubject(load);
    // Reaching the assertion at all is half the point: an uncaught rejection
    // would have propagated out of render.
    expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
  });

  it("recovers on retry — the second attempt succeeds", async () => {
    const { load, calls } = flakyLoad(1);
    renderSubject(load);
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByTestId("loaded")).toHaveTextContent("chunk content");
    expect(calls.count).toBe(2);
  });

  it("re-invokes the thunk on every retry, so a repeated failure is not sticky", async () => {
    // The regression this component exists for: a module-level React.lazy
    // caches its REJECTION, so retry #2 would never call `load` again.
    const { load, calls } = flakyLoad(2);
    renderSubject(load);

    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByRole("alert");
    expect(calls.count).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("loaded")).toBeTruthy();
    expect(calls.count).toBe(3);
  });

  it("keeps the retry usable when a chunk fails several times in a row", async () => {
    const { load } = flakyLoad(3);
    renderSubject(load);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await screen.findByRole("alert");
      await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    }

    expect(await screen.findByTestId("loaded")).toBeTruthy();
  });

  it("surfaces the underlying error to the caller's fallback", async () => {
    const seen = vi.fn();
    render(
      <RetryableLazy
        feature="Test chunk"
        load={() => Promise.reject(new Error("chunk 404"))}
        componentProps={{ label: "x" }}
        renderError={(retry, error) => {
          seen(error.message);
          return (
            <button type="button" onClick={retry}>
              try again
            </button>
          );
        }}
      />,
    );

    await screen.findByRole("button", { name: /try again/i });
    expect(seen).toHaveBeenCalledWith("chunk 404");
  });
});

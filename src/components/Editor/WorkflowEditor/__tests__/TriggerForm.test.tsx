// Phase 7 WI-7.1 — TriggerForm tests.
//
// TriggerForm is read-only in Phase 7: trigger structure (event +
// branches + tags + paths + types + cron + inputs) is dense and easy
// to render incorrectly via single-line text inputs. The plan defers
// editable trigger forms to a follow-up.

import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TriggerIR } from "@/lib/ghaWorkflow/types";
import { TriggerForm } from "../TriggerForm";

afterEach(() => {
  cleanup();
});

function makeTrigger(overrides: Partial<TriggerIR> = {}): TriggerIR {
  return {
    event: "push",
    position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    ...overrides,
  };
}

describe("TriggerForm", () => {
  it("renders nothing-found state when triggers is empty", () => {
    render(<TriggerForm triggers={[]} />);
    expect(screen.getByText(/no triggers/i)).toBeDefined();
  });

  it("renders an event name as monospace text", () => {
    render(<TriggerForm triggers={[makeTrigger({ event: "push" })]} />);
    expect(screen.getByText("push")).toBeDefined();
  });

  it("renders branches[] in a metadata row", () => {
    render(
      <TriggerForm
        triggers={[makeTrigger({ branches: ["main", "develop"] })]}
      />,
    );
    expect(screen.getByText(/main, develop/)).toBeDefined();
  });

  it("renders cron schedules", () => {
    render(
      <TriggerForm triggers={[makeTrigger({ event: "schedule", cron: "0 0 * * *" })]} />,
    );
    expect(screen.getByText(/0 0 \* \* \*/)).toBeDefined();
  });

  it("renders multiple triggers as a list", () => {
    render(
      <TriggerForm
        triggers={[
          makeTrigger({ event: "push", branches: ["main"] }),
          makeTrigger({
            event: "pull_request",
            branches: ["main"],
            types: ["opened", "synchronize"],
          }),
        ]}
      />,
    );
    expect(screen.getByText("push")).toBeDefined();
    expect(screen.getByText("pull_request")).toBeDefined();
    expect(screen.getByText(/opened, synchronize/)).toBeDefined();
  });
});

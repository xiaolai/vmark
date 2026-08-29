// WI-13 — the mount path for a lazily-imported format surface (D4).
//
// The invariant D4 pins: a rejected surface thunk produces a DEFINED,
// OBSERVABLE error surface — never a silent blank editor — and the next mount
// retries. React.lazy is what makes the second half non-obvious: it caches the
// rejected promise for the lifetime of the lazy component object, so the naive
// wiring is sticky-by-accident and every test still passes.
//
// The thunk is the unit's declared input, so a rejecting thunk fixture is not
// mocking own code — no module mocks here, real registry types throughout.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import { FormatSurface } from "./FormatSurface";
import { __resetFormatSurfaceCache } from "@/lib/formats/lazySurfaces";
import type { FormatConfig } from "@/lib/formats/types";

const Surface: ComponentType<{ tabId: string }> = ({ tabId }) => (
  <div data-testid="surface">surface for {tabId}</div>
);

function configWith(
  id: string,
  wysiwygComponent: FormatConfig["wysiwygComponent"],
): FormatConfig {
  return {
    id,
    nameI18nKey: `format.${id}`,
    extensions: [id],
    kind: "wysiwyg",
    wysiwygComponent,
    adapters: {
      saveDialogFilters: [{ nameI18nKey: `format.${id}`, extensions: [id] }],
      untitledExtension: id,
      readOnlyDefault: false,
      closeSavePolicy: "prompt-on-close",
      menuPolicy: {
        sourceWysiwygToggle: false,
        cjkFormatActions: false,
        insertBlockActions: false,
        paragraphFormatting: false,
      },
    },
  };
}

/** React logs every boundary-caught error; the assertions are the contract. */
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetFormatSurfaceCache();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  __resetFormatSurfaceCache();
});

describe("FormatSurface — successful load", () => {
  it("mounts the resolved component and passes the tabId through", async () => {
    const config = configWith("ok", () => Promise.resolve({ default: Surface }));

    render(<FormatSurface formatConfig={config} tabId="tab-7" />);

    expect(await screen.findByTestId("surface")).toHaveTextContent("surface for tab-7");
  });

  it("evaluates the thunk once across two mounts of the same format", async () => {
    let calls = 0;
    const config = configWith("cached", () => {
      calls += 1;
      return Promise.resolve({ default: Surface });
    });

    const first = render(<FormatSurface formatConfig={config} tabId="tab-1" />);
    await screen.findByTestId("surface");
    first.unmount();

    render(<FormatSurface formatConfig={config} tabId="tab-2" />);
    expect(await screen.findByTestId("surface")).toHaveTextContent("surface for tab-2");
    expect(calls).toBe(1);
  });
});

describe("FormatSurface — rejection (D4)", () => {
  it("renders an observable error surface naming the format, not a blank editor", async () => {
    const config = configWith("broken", () => Promise.reject(new Error("chunk 404")));

    render(<FormatSurface formatConfig={config} tabId="tab-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-format-surface-error", "broken");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("retries on the NEXT mount — React.lazy's cached rejection must not stick", async () => {
    let calls = 0;
    const config = configWith("flaky", () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve({ default: Surface });
    });

    const first = render(<FormatSurface formatConfig={config} tabId="tab-1" />);
    await screen.findByRole("alert");
    first.unmount();

    render(<FormatSurface formatConfig={config} tabId="tab-1" />);

    expect(await screen.findByTestId("surface")).toBeInTheDocument();
    expect(calls).toBe(2);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe("FormatSurface — misregistered adapter", () => {
  it("shows the error surface rather than rendering nothing when the thunk is absent", async () => {
    // registerFormat rejects this shape, so reaching it means the config came
    // from somewhere that bypassed registration. Fail visibly either way.
    const config = configWith("nosurface", undefined);

    render(<FormatSurface formatConfig={config} tabId="tab-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-format-surface-error", "nosurface");
  });
});

// WI-UI4.4 — the failure surface names the format and offers an in-place
// Retry that bumps the lazy key (a fresh lazy + fresh boundary, no remount
// from outside required).
describe("FormatSurface — in-place retry (WI-UI4.4)", () => {
  it("renders the format name and a Retry .vm-btn; clicking it retries the thunk", async () => {
    let attempts = 0;
    const thunk = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("transient"))
        : Promise.resolve({ default: Surface });
    });
    render(<FormatSurface formatConfig={configWith("fmt-retry", thunk)} tabId="t1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("fmt-retry");
    const retry = screen.getByRole("button", { name: /try again/i });
    expect(retry.className).toContain("vm-btn");
    retry.click();
    await waitFor(() => expect(screen.getByTestId("surface")).toBeInTheDocument());
  });

  it("names the format via the COMMON namespace, not the raw id (WI-UI4.4)", async () => {
    // "txt" has a real display name; an editor-namespace lookup with a raw-id
    // defaultValue silently showed "txt" here (audit round 2, finding 26).
    const thunk = vi.fn(() => Promise.reject(new Error("transient")));
    render(<FormatSurface formatConfig={configWith("txt", thunk)} tabId="t1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Plain Text");
  });
});

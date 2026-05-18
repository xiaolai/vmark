import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

// React intentionally surfaces caught errors to console.error during render —
// suppress for the duration of these tests so the noisy stack traces don't
// pollute the test output. The boundary's own logging (appError) is preserved.
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function ThrowingChild({ message }: { message: string }): ReactElement {
  throw new Error(message);
}

describe("FeatureErrorBoundary", () => {
  it("renders children when no error is thrown", () => {
    render(
      <FeatureErrorBoundary feature="Test">
        <div>healthy content</div>
      </FeatureErrorBoundary>,
    );
    expect(screen.queryByText("healthy content")).not.toBeNull();
  });

  it("catches a thrown error and shows the feature name", () => {
    render(
      <FeatureErrorBoundary feature="Editor">
        <ThrowingChild message="boom inside editor" />
      </FeatureErrorBoundary>,
    );
    expect(screen.queryByText(/Editor failed to render/)).not.toBeNull();
    expect(screen.queryByText(/boom inside editor/)).not.toBeNull();
  });

  it('exposes a "Try again" button that resets the boundary', () => {
    let shouldThrow = true;
    function MaybeThrowing() {
      if (shouldThrow) {
        throw new Error("first render bad");
      }
      return <div>recovered</div>;
    }

    const { rerender } = render(
      <FeatureErrorBoundary feature="Editor">
        <MaybeThrowing />
      </FeatureErrorBoundary>,
    );
    expect(screen.queryByText(/Editor failed to render/)).not.toBeNull();

    // Simulate the underlying condition being fixed before retry.
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    // Force a fresh render so the boundary re-renders its children.
    rerender(
      <FeatureErrorBoundary feature="Editor">
        <MaybeThrowing />
      </FeatureErrorBoundary>,
    );
    expect(screen.queryByText("recovered")).not.toBeNull();
  });

  it("renders the custom fallback when provided", () => {
    render(
      <FeatureErrorBoundary
        feature="Mermaid"
        fallback={(err, _reset) => <p>fallback: {err.message}</p>}
      >
        <ThrowingChild message="syntax error" />
      </FeatureErrorBoundary>,
    );
    expect(screen.queryByText("fallback: syntax error")).not.toBeNull();
  });
});

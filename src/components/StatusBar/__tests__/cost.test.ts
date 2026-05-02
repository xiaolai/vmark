/**
 * Tests for cost
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar";
import { calculateTotalCost } from "../statusBarUtils";

describe("StatusBar", () => {
  it("displays cost with multiple decimal places", async () => {
    render(<StatusBar />);
    const costElement = screen.getByText(/\$[0-9.]+/);
    expect(costElement).toBeInTheDocument();
    expect(costElement).toHaveTextContent("$6.56");
  });

  describe("calculateTotalCost", () => {
    it("returns 0 for empty runs array", () => {
      expect(calculateTotalCost([])).toBe(0);
    });

    it("calculates total cost correctly", () => {
      const runs = [
        { cost: 6.56, timestamp: Date.now() } as any,
        { cost: 10.00, timestamp: Date.now() } as any,
      ];
      expect(calculateTotalCost(runs)).toBeCloseTo(16.56, 2);
    });
  });
});
import { describe, it, expect } from "vitest";
import { parseWikiLinkBody, formatWikiLink, isValidWikiTarget } from "./operations";

describe("parseWikiLinkBody", () => {
  it("returns target only when no pipe is present", () => {
    expect(parseWikiLinkBody("Home")).toEqual({ target: "Home", alias: null });
  });
  it("splits target | alias", () => {
    expect(parseWikiLinkBody("Home|Start Page")).toEqual({
      target: "Home",
      alias: "Start Page",
    });
  });
  it("trims target and alias independently", () => {
    expect(parseWikiLinkBody("  Home  |  Welcome  ")).toEqual({
      target: "Home",
      alias: "Welcome",
    });
  });
  it("treats whitespace-only alias as null", () => {
    expect(parseWikiLinkBody("Home|   ")).toEqual({ target: "Home", alias: null });
  });
});

describe("formatWikiLink", () => {
  it("formats target without alias", () => {
    expect(formatWikiLink({ target: "Home", alias: null })).toBe("[[Home]]");
  });
  it("formats target with alias", () => {
    expect(formatWikiLink({ target: "Home", alias: "Start" })).toBe("[[Home|Start]]");
  });
  it("trims target and alias on format", () => {
    expect(formatWikiLink({ target: "  Home  ", alias: "  Start  " })).toBe(
      "[[Home|Start]]",
    );
  });
});

describe("isValidWikiTarget", () => {
  it.each([
    ["Home", true],
    ["  Home  ", true],
    ["", false],
    ["   ", false],
  ])("isValidWikiTarget(%j) -> %s", (input, expected) => {
    expect(isValidWikiTarget(input)).toBe(expected);
  });
});

// @vitest-environment node
// Session-scoped HTML trust store (issue #1273).

import { beforeEach, describe, expect, it } from "vitest";
import { useHtmlTrustStore } from "./htmlTrustStore";

const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);

beforeEach(() => {
  useHtmlTrustStore.getState().clearAll();
});

describe("htmlTrustStore", () => {
  it("starts with nothing trusted", () => {
    expect(useHtmlTrustStore.getState().grants).toEqual({});
  });

  it("reports a granted path as trusted", () => {
    useHtmlTrustStore.getState().grant("/labs/thermometer.html", TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor("/labs/thermometer.html")).toBe(TOKEN);
  });

  it("does not leak a grant to a different path", () => {
    useHtmlTrustStore.getState().grant("/labs/a.html", TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor("/labs/b.html")).toBeNull();
  });

  /// Requirement 10: trust follows an explicit authorization of ONE file,
  /// never an extension, a directory, or a sibling.
  it("does not treat a path prefix as a grant", () => {
    useHtmlTrustStore.getState().grant("/labs", TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor("/labs/a.html")).toBeNull();
  });

  it("returns null for an untitled (pathless) document", () => {
    expect(useHtmlTrustStore.getState().tokenFor(null)).toBeNull();
  });

  it("refuses to grant trust to a pathless document", () => {
    useHtmlTrustStore.getState().grant(null, TOKEN);
    expect(useHtmlTrustStore.getState().grants).toEqual({});
  });

  it("refuses to grant trust under an empty path", () => {
    useHtmlTrustStore.getState().grant("", TOKEN);
    expect(useHtmlTrustStore.getState().grants).toEqual({});
  });

  it("revoke removes exactly one grant", () => {
    const s = useHtmlTrustStore.getState();
    s.grant("/a.html", TOKEN);
    s.grant("/b.html", OTHER);
    s.revoke("/a.html");
    expect(useHtmlTrustStore.getState().tokenFor("/a.html")).toBeNull();
    expect(useHtmlTrustStore.getState().tokenFor("/b.html")).toBe(OTHER);
  });

  it("revoking an ungranted path is a no-op", () => {
    useHtmlTrustStore.getState().revoke("/never-granted.html");
    expect(useHtmlTrustStore.getState().grants).toEqual({});
  });

  it("revoking a pathless document is a no-op", () => {
    useHtmlTrustStore.getState().grant("/a.html", TOKEN);
    useHtmlTrustStore.getState().revoke(null);
    expect(useHtmlTrustStore.getState().tokenFor("/a.html")).toBe(TOKEN);
  });

  it("re-granting the same path replaces its token", () => {
    const s = useHtmlTrustStore.getState();
    s.grant("/a.html", TOKEN);
    s.grant("/a.html", OTHER);
    expect(useHtmlTrustStore.getState().tokenFor("/a.html")).toBe(OTHER);
    expect(Object.keys(useHtmlTrustStore.getState().grants)).toHaveLength(1);
  });

  it("clearAll drops every grant", () => {
    const s = useHtmlTrustStore.getState();
    s.grant("/a.html", TOKEN);
    s.grant("/b.html", OTHER);
    s.clearAll();
    expect(useHtmlTrustStore.getState().grants).toEqual({});
  });

  it("exposes every live token, for bulk revocation on teardown", () => {
    const s = useHtmlTrustStore.getState();
    s.grant("/a.html", TOKEN);
    s.grant("/b.html", OTHER);
    expect(useHtmlTrustStore.getState().tokens().sort()).toEqual([TOKEN, OTHER].sort());
  });

  /// The store must not be persisted: a document trusted in one session is
  /// untrusted in the next (requirement 4). A `persist` middleware would show
  /// up as this property on the hook.
  it("is not persisted", () => {
    expect(
      (useHtmlTrustStore as unknown as { persist?: unknown }).persist,
    ).toBeUndefined();
  });

  it("distinguishes paths that differ only by case", () => {
    const s = useHtmlTrustStore.getState();
    s.grant("/Labs/A.html", TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor("/labs/a.html")).toBeNull();
  });

  it("handles CJK and spaces in paths", () => {
    const path = "/实验/用普通温度计测量温度 v2.html";
    useHtmlTrustStore.getState().grant(path, TOKEN);
    expect(useHtmlTrustStore.getState().tokenFor(path)).toBe(TOKEN);
  });
});

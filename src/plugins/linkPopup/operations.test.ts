import { describe, it, expect, vi } from "vitest";

const openFilepathLinkMock = vi.fn(async () => {});
vi.mock("@/utils/linkOpen", async () => {
  const actual = await vi.importActual<typeof import("@/utils/linkOpen")>("@/utils/linkOpen");
  return {
    ...actual,
    openFilepathLink: (...args: unknown[]) => openFilepathLinkMock(...args),
  };
});

import { classifyLinkAction, openLink } from "./operations";

describe("classifyLinkAction", () => {
  it("classifies a fragment href", () => {
    expect(classifyLinkAction("#intro")).toEqual({
      kind: "fragment",
      targetId: "intro",
    });
  });
  it("classifies an external URL", () => {
    expect(classifyLinkAction("https://example.com")).toEqual({ kind: "external" });
  });
  it("classifies a relative filepath", () => {
    expect(classifyLinkAction("./notes.md")).toEqual({ kind: "filepath" });
  });
});

describe("openLink", () => {
  it("calls navigateToFragment for fragment links when provided", async () => {
    const nav = vi.fn(() => true);
    await openLink("#section", null, nav);
    expect(nav).toHaveBeenCalledWith("section");
  });
  it("is a no-op for fragment when navigateToFragment is null", async () => {
    await expect(openLink("#section", null, null)).resolves.toBeUndefined();
  });
  it("delegates to openFilepathLink for filepath links", async () => {
    openFilepathLinkMock.mockClear();
    await openLink("./other.md", "/x/here.md", null);
    expect(openFilepathLinkMock).toHaveBeenCalledWith("./other.md", "/x/here.md");
  });
  it("swallows errors from openFilepathLink without throwing", async () => {
    openFilepathLinkMock.mockRejectedValueOnce(new Error("nope"));
    await expect(openLink("./bad.md", null, null)).resolves.toBeUndefined();
  });
  it("is a no-op for external links (handled elsewhere)", async () => {
    openFilepathLinkMock.mockClear();
    await openLink("https://example.com", null, null);
    expect(openFilepathLinkMock).not.toHaveBeenCalled();
  });
  it("is a no-op for empty href", async () => {
    await expect(openLink("", null, null)).resolves.toBeUndefined();
  });
});

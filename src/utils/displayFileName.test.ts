import { describe, expect, it } from "vitest";
import { formatFileDisplayName } from "./displayFileName";

describe("formatFileDisplayName", () => {
  it("keeps the extension when extensions are shown", () => {
    expect(formatFileDisplayName("README.md", true)).toBe("README.md");
    expect(formatFileDisplayName("requirements.txt", true)).toBe("requirements.txt");
  });

  it("strips a registered extension when they are hidden", () => {
    expect(formatFileDisplayName("README.md", false)).toBe("README");
    expect(formatFileDisplayName("requirements.txt", false)).toBe("requirements");
  });

  it("leaves an unregistered extension alone even when hiding", () => {
    // Hiding ".vue" would be a lie: VMark cannot open it, so the name it
    // displays must be the name on disk.
    expect(formatFileDisplayName("App.vue", false)).toBe("App.vue");
  });

  it("leaves names with no extension alone in both modes", () => {
    expect(formatFileDisplayName("Makefile", true)).toBe("Makefile");
    expect(formatFileDisplayName("Makefile", false)).toBe("Makefile");
    expect(formatFileDisplayName("", true)).toBe("");
    expect(formatFileDisplayName("", false)).toBe("");
  });

  it("does not eat a dotfile's whole name", () => {
    expect(formatFileDisplayName(".gitignore", false)).toBe(".gitignore");
  });

  // `.gitignore` alone does not cover this: its extension is unregistered, so
  // the stripper never fires. A file named exactly `.md` hits the branch —
  // and an empty label is worse than the extension it was hiding.
  it("never returns an empty label for a file named only an extension", () => {
    expect(formatFileDisplayName(".md", false)).toBe(".md");
    expect(formatFileDisplayName(".txt", false)).toBe(".txt");
    expect(formatFileDisplayName(".yaml", false)).toBe(".yaml");
  });

  it("strips only the last extension of a double-barrelled name", () => {
    expect(formatFileDisplayName("notes.md.md", false)).toBe("notes.md");
  });

  it("passes an untitled tab title through untouched", () => {
    expect(formatFileDisplayName("Untitled-1", false)).toBe("Untitled-1");
  });
});

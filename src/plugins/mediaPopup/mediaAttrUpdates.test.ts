/**
 * Which media edits detach a stored reference identity.
 *
 * Each case here is a save-time data-loss bug if it regresses: a node that
 * keeps `referenceId` re-serializes as `![alt][id]`, so whatever the user
 * changed is replaced by the definition's old value on the next parse.
 */
import { describe, it, expect } from "vitest";
import {
  attrsForSingleEdit,
  attrsForImageEdit,
  attrsForMediaEdit,
} from "./mediaAttrUpdates";
import {
  parseMarkdown,
  serializeMarkdown,
} from "@/utils/markdownPipeline/adapter";
import { getProductionSchema } from "@/test/productionSchema";

const withRef = {
  src: "/old.png",
  alt: "Logo",
  title: "T",
  poster: "",
  referenceId: "logo",
  referenceType: "full",
};

describe("attrsForSingleEdit", () => {
  it("detaches when the source changes", () => {
    const out = attrsForSingleEdit(withRef, "src", "/new.png");
    expect(out.src).toBe("/new.png");
    expect(out.referenceId).toBeNull();
    expect(out.referenceType).toBeNull();
  });

  it("detaches when the poster changes", () => {
    expect(attrsForSingleEdit(withRef, "poster", "/p.png").referenceId).toBeNull();
  });

  it("detaches when the title changes — a reference cannot carry a title", () => {
    expect(attrsForSingleEdit(withRef, "title", "New").referenceId).toBeNull();
  });

  it("KEEPS the reference when only alt changes", () => {
    // An ImageReference carries its own alt text, so a caption tweak must
    // not throw away the author's reference form.
    const out = attrsForSingleEdit(withRef, "alt", "New alt");
    expect(out.alt).toBe("New alt");
    expect(out.referenceId).toBe("logo");
  });

  it("keeps the reference when the value is unchanged", () => {
    expect(attrsForSingleEdit(withRef, "src", "/old.png").referenceId).toBe("logo");
  });
});

describe("attrsForImageEdit", () => {
  it("detaches on a new source", () => {
    expect(attrsForImageEdit(withRef, "/new.png", "Logo").referenceId).toBeNull();
  });

  it("keeps the reference when only alt changes", () => {
    expect(attrsForImageEdit(withRef, "/old.png", "Other").referenceId).toBe("logo");
  });
});

describe("attrsForMediaEdit", () => {
  it("detaches on a new source", () => {
    expect(attrsForMediaEdit(withRef, "/new.mp4", "T", "").referenceId).toBeNull();
  });

  it("detaches on a new title", () => {
    expect(attrsForMediaEdit(withRef, "/old.png", "New", "").referenceId).toBeNull();
  });

  it("detaches on a new poster", () => {
    expect(attrsForMediaEdit(withRef, "/old.png", "T", "/p.png").referenceId).toBeNull();
  });

  it("keeps the reference when nothing changed", () => {
    expect(attrsForMediaEdit(withRef, "/old.png", "T", "").referenceId).toBe("logo");
  });
});

describe("end to end: editing the source changes the saved markdown", () => {
  // The unit rules above only matter if they reach the file. This drives the
  // real edit path and reads the markdown that would be written.
  const schema = getProductionSchema();

  it("saves the new URL instead of re-emitting the old reference", () => {
    const doc = parseMarkdown(schema, "![Logo][logo]\n\n[logo]: /logo.png");
    let pos = -1;
    doc.descendants((node, at) => {
      if (node.type.name.includes("image") && node.attrs.referenceId) pos = at;
    });
    expect(pos).toBeGreaterThanOrEqual(0);

    const node = doc.nodeAt(pos)!;
    const edited = node.type.create(
      attrsForSingleEdit(node.attrs, "src", "/new-logo.png"),
    );
    const newDoc = doc.copy(
      doc.content.replaceChild(doc.content.findIndex(pos).index, edited),
    );

    const out = serializeMarkdown(schema, newDoc).trim();
    expect(out).toContain("/new-logo.png");
    expect(out).not.toMatch(/!\[Logo\]\[logo\]/);
  });
});

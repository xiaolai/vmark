// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  referenceIdentityAttrs,
  detachedReferenceAttrs,
  readReferenceIdentity,
  NO_REFERENCE,
} from "./referenceIdentity";

describe("referenceIdentityAttrs", () => {
  it("defaults to null so pre-existing documents load unchanged", () => {
    expect(referenceIdentityAttrs.referenceId.default).toBeNull();
    expect(referenceIdentityAttrs.referenceType.default).toBeNull();
  });

  it("is never rendered into the DOM", () => {
    // Otherwise serialization bookkeeping leaks into the document and into
    // copied HTML.
    expect(referenceIdentityAttrs.referenceId.rendered).toBe(false);
    expect(referenceIdentityAttrs.referenceType.rendered).toBe(false);
  });
});

describe("detachedReferenceAttrs", () => {
  it("clears the identity — editing the source must not keep the reference", () => {
    expect(detachedReferenceAttrs()).toEqual(NO_REFERENCE);
  });

  it("returns a fresh object each time", () => {
    expect(detachedReferenceAttrs()).not.toBe(detachedReferenceAttrs());
  });
});

describe("readReferenceIdentity", () => {
  it("reads a full reference", () => {
    expect(
      readReferenceIdentity({ referenceId: "logo", referenceType: "full" }),
    ).toEqual({ referenceId: "logo", referenceType: "full" });
  });

  it("normalizes missing, empty and non-string values to null", () => {
    expect(readReferenceIdentity(undefined)).toEqual(NO_REFERENCE);
    expect(readReferenceIdentity({})).toEqual(NO_REFERENCE);
    expect(readReferenceIdentity({ referenceId: "" })).toEqual(NO_REFERENCE);
    expect(readReferenceIdentity({ referenceId: 42 })).toEqual(NO_REFERENCE);
  });
});

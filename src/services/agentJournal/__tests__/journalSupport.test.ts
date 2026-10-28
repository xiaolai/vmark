// @vitest-environment node
// WI-AL1.3 — the pieces a controlled write sends to the journal: the MCP actor (all four principal states), lone surrogates refused as INVALID_TEXT before anything crosses, refusals read from detail.journalCode (JOURNAL_BUSY, STALE_PARENT with its head), and the per-tab basis the two-window parent CAS relies on
import { describe, it, expect, beforeEach } from "vitest";
import { FIXTURE_ATTRIBUTIONS, TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "../journalActor";
import { isWellFormedText } from "../wellFormedText";
import { JournalRefusal, toJournalRefusal } from "../journalRefusal";
import {
  docKeyFor,
  forgetJournalBasis,
  journalBasis,
  rememberJournalBasis,
  resetJournalBases,
} from "../documentIdentity";

describe("journalActorFor", () => {
  it("maps a provider principal with its label and display name", () => {
    const actor = journalActorFor(TEST_ATTRIBUTION);
    expect(actor.type).toBe("mcp");
    expect(actor.principal).toEqual({ state: "provider", provider: expect.any(String) });
    expect(actor.connectionId).toBe(TEST_ATTRIBUTION.connectionId);
    expect(actor.sessionLabel).toBe(TEST_ATTRIBUTION.sessionLabel);
  });

  it.each(["anonymous", "unrecognized", "ambiguous"] as const)("keeps the %s state distinct", (state) => {
    const actor = journalActorFor(FIXTURE_ATTRIBUTIONS[state]);
    expect(actor.principal).toEqual({ state });
  });

  it("omits absent label and name instead of sending null", () => {
    const actor = journalActorFor({ ...TEST_ATTRIBUTION, sessionLabel: null, displayName: null });
    expect("sessionLabel" in actor).toBe(false);
    expect("displayName" in actor).toBe(false);
  });
});

describe("isWellFormedText", () => {
  it.each([
    ["", true],
    ["plain", true],
    ["中文 and emoji 😀", true],
    ["�", true],
    ["😀", true],
    ["\uD800", false],
    ["\uDC00", false],
    ["a\uD83D", false],
    ["\uDE00a", false],
    ["\uDE00\uD83D", false],
  ])("%j → %s", (text, ok) => {
    expect(isWellFormedText(text)).toBe(ok);
  });
});

describe("toJournalRefusal", () => {
  it("reads the journal token from detail.journalCode", () => {
    const r = toJournalRefusal({
      code: "conflict",
      message: "JOURNAL_BUSY: …",
      detail: { journalCode: "JOURNAL_BUSY" },
    });
    expect(r).toBeInstanceOf(JournalRefusal);
    expect(r.journalCode).toBe("JOURNAL_BUSY");
    expect(r.head).toBeNull();
  });

  it("carries the current head of a STALE_PARENT refusal", () => {
    const head = "0190d3c4-0000-7000-8000-000000000001";
    const r = toJournalRefusal({ code: "conflict", message: "m", detail: { journalCode: "STALE_PARENT", head } });
    expect(r.journalCode).toBe("STALE_PARENT");
    expect(r.head).toBe(head);
  });

  it.each([
    ["a plain string", "command agent_journal_prepare not found"],
    ["an Error", new Error("ipc closed")],
    ["undefined", undefined],
    ["an unknown journal code", { code: "conflict", message: "m", detail: { journalCode: "NEW_THING" } }],
    ["a typed error without detail", { code: "internal", message: "join failed" }],
  ])("treats %s as JOURNAL_UNAVAILABLE", (_label, error) => {
    expect(toJournalRefusal(error).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });

  it("passes a JournalRefusal through unchanged", () => {
    const r = new JournalRefusal("INVALID_TEXT", "x");
    expect(toJournalRefusal(r)).toBe(r);
  });
});

describe("documentIdentity", () => {
  beforeEach(() => resetJournalBases());

  it("keys a saved file by its path and an untitled tab by window and tab", () => {
    expect(docKeyFor({ tabId: "t1", filePath: "/notes/a.md" }, "main")).toBe("path:/notes/a.md");
    expect(docKeyFor({ tabId: "t1", filePath: null }, "main")).toBe("tab:main/t1");
    expect(docKeyFor({ tabId: "t1", filePath: "/文档/笔记.md" }, "w2")).toBe("path:/文档/笔记.md");
  });

  it("two windows on one file share the key, so they contend for one document", () => {
    expect(docKeyFor({ tabId: "a", filePath: "/x.md" }, "main")).toBe(
      docKeyFor({ tabId: "b", filePath: "/x.md" }, "doc-2"),
    );
  });

  it("remembers the last revision per tab and document, and forgets on request", () => {
    expect(journalBasis("t1", "path:/a.md")).toBeNull();
    rememberJournalBasis("t1", "path:/a.md", "r1");
    expect(journalBasis("t1", "path:/a.md")).toBe("r1");
    expect(journalBasis("t2", "path:/a.md")).toBeNull();
    expect(journalBasis("t1", "path:/b.md")).toBeNull();
    forgetJournalBasis("t1", "path:/a.md");
    expect(journalBasis("t1", "path:/a.md")).toBeNull();
  });
});

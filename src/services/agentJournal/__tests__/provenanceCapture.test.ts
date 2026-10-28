// @vitest-environment node
// WI-AL2.2a — every freeze of a provenance session carries a capture id {view, session, seq}: one random session id per session (never shared by two sessions), seq a canonical decimal string that strictly increases with each freeze (the over-budget freeze included), and a view fitted to the journal's 128-byte limit on whole code points
import { describe, it, expect, vi } from "vitest";
import { ProvenanceSession, type SessionJournal } from "../provenance/session";
import { CAPTURE_PART_MAX_BYTES } from "../provenance/captureId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const journal = (): SessionJournal => ({
  arm: () => Promise.reject(new Error("not armed in this test")),
  close: async () => {},
});

const session = (view: string, maxFrozen?: number) =>
  new ProvenanceSession("text", journal(), { warn: vi.fn(), view, ...(maxFrozen === undefined ? {} : { maxFrozen }) });

describe("provenance capture ids", () => {
  it("names the view and one v4 session id, with seq 1, 2, … as decimal strings", () => {
    const s = session("main/t-1");
    const [a, b, c] = [s.freeze("text"), s.freeze("text"), s.freeze("text changed")];
    expect(a.capture).toEqual({ view: "main/t-1", session: expect.stringMatching(UUID_V4), seq: "1" });
    expect(b.capture).toEqual({ ...a.capture, seq: "2" });
    expect(c.capture).toEqual({ ...a.capture, seq: "3" });
  });

  it("gives two sessions of one view different session ids, each starting its own seq", () => {
    const first = session("main/t-1").freeze("text").capture;
    const second = session("main/t-1").freeze("text").capture;
    expect(second.session).not.toBe(first.session);
    expect(second.seq).toBe("1");
  });

  it("still mints the next seq for a freeze refused over the frozen-window budget", () => {
    const s = session("main/t-1", 1);
    expect(s.freeze("text").capture.seq).toBe("1");
    const over = s.freeze("text");
    expect(over.touched).toBe(true);
    expect(over.capture.seq).toBe("2");
  });

  it("fits a long view to the byte limit without splitting a character", () => {
    const view = `main/${"稿".repeat(100)}`;
    const fitted = session(view).freeze("text").capture.view;
    const bytes = new TextEncoder().encode(fitted).length;
    expect(bytes).toBeLessThanOrEqual(CAPTURE_PART_MAX_BYTES);
    expect(bytes).toBeGreaterThan(CAPTURE_PART_MAX_BYTES - 3);
    expect(view.startsWith(fitted)).toBe(true);
  });

  it("keeps a non-empty view for an empty name", () => {
    expect(session("").freeze("text").capture.view.length).toBeGreaterThan(0);
  });
});

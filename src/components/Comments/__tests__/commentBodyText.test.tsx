// WI-AL3.2 — comment text renders as text only: a body, a reply, a quote and an author holding HTML show their characters and create no element from them (no script, no img, no handler attribute), in the thread view the panel renders; a quote, clamped to three lines with an ellipsis, keeps its full text as its title
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CommentThread } from "@/services/agentJournal/comments/commentReplies";
import { CommentThreadView } from "../CommentThreadView";

const BODY = `<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"><b>bold</b>`;
const REPLY = `<img src=y onerror="window.__pwned = 3">`;
const QUOTE = `<script>quote()</script>`;
const AUTHOR = `<img src=z>`;

const thread: CommentThread = {
  comment: "c1",
  state: "open",
  commentGen: "0",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: QUOTE,
  body: BODY,
  author: AUTHOR,
  caller: "agent",
  replies: [{ reply: "r2", body: REPLY, author: "", caller: "user" }],
  anchor: { status: "resolved", tier: "context", start: 0, end: 5, byHint: true },
};

describe("comment text", () => {
  it("a comment body with HTML renders as text, with no element from the body", () => {
    const { container } = render(<CommentThreadView docKey="path:/a.md" thread={thread} actions={{ busy: false, run: vi.fn() }} replying={false} onReplying={vi.fn()} focus={{ begin: () => 0, intend: vi.fn(), settle: vi.fn() }} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    const bodies = container.querySelectorAll(".comments-thread__body");
    expect(bodies[0].textContent).toBe(BODY);
    expect(bodies[1]).toHaveTextContent(REPLY);
    expect(container.querySelector(".comments-thread__quote")?.textContent).toBe(QUOTE);
    expect(container.querySelector(".comments-thread__author")?.textContent).toBe(AUTHOR);
    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("a quote the panel clamps keeps its full text reachable as its title", () => {
    const long = Array.from({ length: 8 }, (_, i) => `line ${i}`).join("\n");
    const { container } = render(<CommentThreadView docKey="path:/a.md" thread={{ ...thread, quote: long }} actions={{ busy: false, run: vi.fn() }} replying={false} onReplying={vi.fn()} focus={{ begin: () => 0, intend: vi.fn(), settle: vi.fn() }} />);
    expect(container.querySelector(".comments-thread__quote")).toHaveAttribute("title", long);
  });
});

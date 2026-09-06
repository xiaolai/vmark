// Phase 4 — KB server: ADR-9 auth, routes, path containment, search, backlinks.
// WI-4.3 — SSE live-reload on save coverage.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildIndex, type WorkspaceIndex } from "../index/buildIndex";
import { createContentServer } from "./createServer";
import { SESSION_COOKIE } from "./auth";
import { KB_JS } from "./assets";
import { SlidevManager } from "../slidev/manager";
import type { SlidevModule } from "../slidev/server";

function fakeSlidevManager(): SlidevManager {
  const mod: SlidevModule = {
    resolveOptions: async () => ({}),
    createServer: async () => ({
      listen: async () => {},
      close: async () => {},
      httpServer: { address: () => ({ port: 4321 }) },
      config: { server: { port: 4321 } },
    }),
  };
  return new SlidevManager(async () => mod);
}

let root: string;
let index: WorkspaceIndex;
const BOOTSTRAP = "test-bootstrap-token-123";

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function makeServer() {
  index = await buildIndex(root);
  return createContentServer({ root, bootstrapToken: BOOTSTRAP, getIndex: () => index });
}

/** Mint a nonce (Bearer-authed), bootstrap with it, return the Cookie header. */
async function authedCookie(app: import("hono").Hono): Promise<string> {
  const mint = await app.request("/__mint", {
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  const { nonce } = (await mint.json()) as { nonce: string };
  const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  // The name is NAMESPACED per workspace root (audit 20260906, MCP-C05), so
  // match the emitted name rather than the bare base constant.
  const m = new RegExp(`(${SESSION_COOKIE}[^=]*)=([^;]+)`).exec(setCookie);
  return `${m![1]}=${m![2]}`;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-srv-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("auth (ADR-9 nonce → cookie; VULN-001 fix)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const res = await app.request("/__health");
    expect(res.status).toBe(401);
  });

  it("rejects /__mint without the bootstrap bearer (403)", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const res = await app.request("/__mint", { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(403);
  });

  it("rejects /__auth with the long-lived token (only nonces accepted)", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const res = await app.request(`/__auth?t=${BOOTSTRAP}`, { redirect: "manual" });
    expect(res.status).toBe(403);
  });

  it("a minted nonce is single-use", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const { nonce } = (await (
      await app.request("/__mint", { headers: { authorization: `Bearer ${BOOTSTRAP}` } })
    ).json()) as { nonce: string };
    const first = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(first.status).toBe(302);
    const second = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
    expect(second.status).toBe(403); // already consumed
  });

  it("sets an HttpOnly SameSite=Strict cookie and then allows access", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    expect(cookie).toContain(SESSION_COOKIE);
    const res = await app.request("/__health", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});

describe("routes (authenticated)", () => {
  it("renders a note with resolved wiki-links", async () => {
    await write("A.md", "# Hello\n\n[[B]]");
    await write("B.md", "b");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/A.md", { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('href="/note/B.md"');
    expect(html).not.toContain("wiki-link--missing");
  });

  it("contains path traversal (400 on escape)", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/..%2f..%2fetc%2fpasswd", { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("404s a missing note", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/Nope.md", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("404s a file that exists on disk but is excluded from the index (Codex audit)", async () => {
    await write("A.md", "hi");
    await write(".secret.md", "top secret"); // hidden → excluded by the walker
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    // Direct /note/ access must not bypass the walk policy.
    const res = await app.request("/note/.secret.md", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("404s a .gitignore'd note even though it exists on disk", async () => {
    await write(".gitignore", "private.md\n");
    await write("A.md", "hi");
    await write("private.md", "secret");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/private.md", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("serves the relationship graph", async () => {
    await write("A.md", "[[B]]");
    await write("B.md", "b");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/api/graph", { headers: { cookie } });
    const graph = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  it("serves a navigable server-rendered graph page (WI-4.4)", async () => {
    await write("A.md", "[[B]]");
    await write("B.md", "b");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/graph", { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Relationship graph");
    // A's outgoing wiki edge to B is a navigable link; B shows a backlink.
    expect(html).toContain('href="/note/B.md"');
    expect(html).toContain("Backlinks");
  });

  it("does not render unresolved wiki-link targets as real docs in /graph", async () => {
    await write("A.md", "[[Missing]]");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const html = await (await app.request("/graph", { headers: { cookie } })).text();
    // The phantom "Missing" node must not get a navigable /note link or section.
    expect(html).not.toContain('href="/note/Missing"');
  });

  it("links the index page to the graph view", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/", { headers: { cookie } });
    expect(await res.text()).toContain('href="/graph"');
  });

  it("serves backlinks", async () => {
    await write("A.md", "[[B]]");
    await write("B.md", "b");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/api/backlinks/B.md", { headers: { cookie } });
    expect(await res.json()).toMatchObject({ relPath: "B.md", backlinks: ["A.md"] });
  });

  it("serves full-text search results", async () => {
    await write("A.md", "the quick brown fox");
    await write("B.md", "nothing here");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/api/search?q=quick", { headers: { cookie } });
    const body = (await res.json()) as { results: { relPath: string }[] };
    expect(body.results.length).toBe(1);
    expect(body.results[0].relPath).toBe("A.md");
  });
});

describe("hardening (grill fixes)", () => {
  it("returns 400 (not 500) on malformed %-encoding — H8", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    expect((await app.request("/note/%", { headers: { cookie } })).status).toBe(400);
    expect((await app.request("/api/backlinks/%", { headers: { cookie } })).status).toBe(400);
  });

  it("rejects NUL bytes in the path — M6", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/A%00.md", { headers: { cookie } });
    expect([400, 404]).toContain(res.status); // rejected, never reads
    expect(res.status).not.toBe(500);
  });

  it("does not follow a symlink that points outside the workspace — M11", async () => {
    await write("real.md", "inside");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-out-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "SECRET");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "leak.md"));
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/note/leak.md", { headers: { cookie } });
    expect(res.status).toBe(404); // realpath escapes root → refused
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("sets CSP + security headers; img-src tightens for untrusted — H1/H4", async () => {
    await write("A.md", "hi");
    const idx = await buildIndex(root);
    const untrusted = createContentServer({ root, bootstrapToken: BOOTSTRAP, getIndex: () => idx });
    const trusted = createContentServer({ root, bootstrapToken: BOOTSTRAP, getIndex: () => idx, trusted: true });
    const cu = await authedCookie(untrusted.app);
    const ct = await authedCookie(trusted.app);
    const ru = await untrusted.app.request("/__health", { headers: { cookie: cu } });
    const rt = await trusted.app.request("/__health", { headers: { cookie: ct } });
    expect(ru.headers.get("content-security-policy")).toContain("img-src 'self' data:;");
    expect(rt.headers.get("content-security-policy")).toContain("img-src 'self' data: https:");
    expect(ru.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves the client assets the shell links — H6", async () => {
    await write("A.md", "hi");
    const { app } = await makeServer();
    const cookie = await authedCookie(app);
    const css = await app.request("/__assets/kb.css", { headers: { cookie } });
    const js = await app.request("/__assets/kb.js", { headers: { cookie } });
    expect(css.status).toBe(200);
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("/__events"); // live-reload wired
  });

  it("health reports degraded when the watcher has an error — H10", async () => {
    await write("A.md", "hi");
    const idx = await buildIndex(root);
    const server = createContentServer({
      root,
      bootstrapToken: BOOTSTRAP,
      getIndex: () => idx,
      health: () => ({ watcherAlive: false, lastError: "boom" }),
    });
    const cookie = await authedCookie(server.app);
    const res = await server.app.request("/__health", { headers: { cookie } });
    expect(await res.json()).toMatchObject({ status: "degraded", lastError: "boom" });
  });
});

describe("slidev preview (C2/C4)", () => {
  async function slidevServer() {
    index = await buildIndex(root);
    return createContentServer({
      root,
      bootstrapToken: BOOTSTRAP,
      getIndex: () => index,
      slidevManager: fakeSlidevManager(),
    });
  }

  it("starts a preview with the bootstrap bearer; rejects without it", async () => {
    await write("deck.md", "# slide");
    const { app } = await slidevServer();
    const ok = await app.request("/api/slidev/preview", {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
      body: JSON.stringify({ deck: `${root}/deck.md` }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, path: "/slidev/" });

    const bad = await app.request("/api/slidev/preview", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ deck: `${root}/deck.md` }),
    });
    expect(bad.status).toBe(403);
  });

  it("503s the /slidev/ proxy when no preview is active", async () => {
    await write("A.md", "x");
    const { app } = await slidevServer();
    const cookie = await authedCookie(app);
    const res = await app.request("/slidev/", { headers: { cookie } });
    expect(res.status).toBe(503);
  });

  it("exports a deck via the bearer-authed endpoint (injected spawn)", async () => {
    await write("deck.md", "# slide");
    index = await buildIndex(root);
    const okSpawn = () => {
      const child = {
        stderr: { on: () => {} },
        on: (e: string, cb: (a: unknown) => void) => {
          if (e === "exit") setTimeout(() => cb(0), 0);
        },
      };
      return child as never;
    };
    const app = createContentServer({
      root,
      bootstrapToken: BOOTSTRAP,
      getIndex: () => index,
      exportDeps: { spawn: okSpawn, resolveEntry: () => "/slidev.mjs", nodeExe: "node" },
    }).app;
    const res = await app.request("/api/slidev/export", {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
      body: JSON.stringify({ deck: `${root}/deck.md`, format: "pdf", output: `${root}/out.pdf` }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, output: `${root}/out.pdf` });
  });

  it("surfaces an export failure (e.g. missing Chromium) as 500", async () => {
    await write("deck.md", "# slide");
    index = await buildIndex(root);
    const failSpawn = () => {
      const child = {
        stderr: { on: (_e: string, cb: (d: unknown) => void) => cb("no chromium") },
        on: (e: string, cb: (a: unknown) => void) => {
          if (e === "exit") setTimeout(() => cb(1), 0);
        },
      };
      return child as never;
    };
    const app = createContentServer({
      root,
      bootstrapToken: BOOTSTRAP,
      getIndex: () => index,
      exportDeps: { spawn: failSpawn, resolveEntry: () => "/s.mjs", nodeExe: "node" },
    }).app;
    const res = await app.request("/api/slidev/export", {
      method: "POST",
      headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
      body: JSON.stringify({ deck: `${root}/deck.md`, format: "pdf", output: "/o.pdf" }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/chromium/);
  });
});

/**
 * Audit 20260906 — MCP-C02 and MCP-C03: ordinary markdown links lost their
 * session, and local images were not served at all.
 */
describe("local links and media (audit 20260906)", () => {
  it("serves a note's local image from the asset route", async () => {
    await write("note.md", "![pic](picture.png)\n");
    // A one-pixel PNG is enough — the route's contract is bytes and a type.
    await fs.writeFile(
      path.join(root, "picture.png"),
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const page = await server.app.request("/note/note.md", { headers: { cookie } });
    const html = await page.text();
    // The image URL is rewritten SERVER-SIDE — the browser starts fetching
    // while the HTML is still parsing, so kb.js could never win that race.
    expect(html).toContain("/asset/picture.png");

    const asset = await server.app.request("/asset/picture.png", { headers: { cookie } });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("image/png");
  });

  it("serves an image from the note's own subdirectory", async () => {
    await write("dir/note.md", "![pic](pic.png)\n");
    await fs.writeFile(path.join(root, "dir/pic.png"), Buffer.from("89504e47", "hex"));
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const html = await (
      await server.app.request("/note/dir/note.md", { headers: { cookie } })
    ).text();
    expect(html).toContain("/asset/dir/pic.png");

    const asset = await server.app.request("/asset/dir/pic.png", { headers: { cookie } });
    expect(asset.status).toBe(200);
  });

  it("requires a session for an asset", async () => {
    await write("note.md", "![pic](picture.png)\n");
    await fs.writeFile(path.join(root, "picture.png"), Buffer.from("89504e47", "hex"));
    const server = await makeServer();

    const asset = await server.app.request("/asset/picture.png");
    expect(asset.status).toBe(401);
  });

  // The allowlist is the boundary: relaxing it to "not markdown" would serve
  // a workspace's .env and private keys.
  it("refuses a non-media file even with a session", async () => {
    await write("note.md", "x\n");
    await fs.writeFile(path.join(root, "secrets.env"), "TOKEN=1");
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const res = await server.app.request("/asset/secrets.env", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("refuses a hidden path", async () => {
    await write("note.md", "x\n");
    await fs.mkdir(path.join(root, ".secret"), { recursive: true });
    await fs.writeFile(path.join(root, ".secret/pic.png"), Buffer.from("89504e47", "hex"));
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const res = await server.app.request("/asset/.secret/pic.png", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("contains path traversal on the asset route", async () => {
    await write("note.md", "x\n");
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const res = await server.app.request("/asset/../../etc/hosts.png", {
      headers: { cookie },
    });
    expect([400, 404]).toContain(res.status);
  });

  it("404s a missing asset rather than erroring", async () => {
    await write("note.md", "x\n");
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const res = await server.app.request("/asset/nope.png", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("leaves a remote image URL alone", async () => {
    await write("note.md", "![pic](https://example.com/a.png)\n");
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const html = await (
      await server.app.request("/note/note.md", { headers: { cookie } })
    ).text();
    expect(html).toContain("https://example.com/a.png");
    expect(html).not.toContain("/asset/https");
  });

  /**
   * MCP-C02: the token propagator only matched `a[href^="/"]`, so an ordinary
   * relative markdown link kept no session and 401'd inside the cookie-blocked
   * in-app iframe. Only wiki-links, which emit absolute `/note/` URLs, worked.
   *
   * The SHIPPED script is executed against a stub DOM rather than grepped, so
   * this asserts what the browser would do, not how the source is spelled.
   */
  describe("session propagation in the shipped client script", () => {
    /** Run KB_JS on a page at `pageUrl` holding `hrefs`; return the rewritten hrefs. */
    function propagate(pageUrl: string, hrefs: string[]): string[] {
      const url = new URL(pageUrl);
      const links = hrefs.map((href) => {
        let value = href;
        return {
          getAttribute: () => value,
          setAttribute: (_name: string, next: string) => {
            value = next;
          },
          get href() {
            return value;
          },
        };
      });
      const handlers: Array<() => void> = [];
      const documentStub = {
        addEventListener: (_event: string, fn: () => void) => handlers.push(fn),
        querySelectorAll: (selector: string) =>
          selector === "a[href]" ? links : [],
      };
      const locationStub = {
        search: url.search,
        origin: url.origin,
        href: url.href,
        reload: () => {},
      };
      const windowStub = {};
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function(
        "document",
        "location",
        "window",
        "EventSource",
        KB_JS,
      )(documentStub, locationStub, windowStub, function EventSourceStub() {
        return { addEventListener: () => {} };
      });
      for (const handler of handlers) handler();
      return links.map((l) => l.href);
    }

    it("carries the session onto a plain relative link", () => {
      expect(
        propagate("http://127.0.0.1:41001/note/dir/A.md?s=tok", ["B.md"]),
      ).toEqual(["/note/dir/B.md?s=tok"]);
    });

    it("carries the session onto a parent-relative link", () => {
      expect(
        propagate("http://127.0.0.1:41001/note/dir/A.md?s=tok", ["../B.md"]),
      ).toEqual(["/note/B.md?s=tok"]);
    });

    it("still handles absolute same-origin links", () => {
      expect(
        propagate("http://127.0.0.1:41001/note/A.md?s=tok", ["/note/B.md"]),
      ).toEqual(["/note/B.md?s=tok"]);
    });

    it("preserves an existing query and fragment", () => {
      expect(
        propagate("http://127.0.0.1:41001/note/A.md?s=tok", ["B.md?x=1#frag"]),
      ).toEqual(["/note/B.md?x=1&s=tok#frag"]);
    });

    it("leaves external, protocol-relative and non-navigational links alone", () => {
      expect(
        propagate("http://127.0.0.1:41001/note/A.md?s=tok", [
          "https://example.com/x",
          "//example.com/x",
          "mailto:a@b.c",
          "#section",
        ]),
      ).toEqual(["https://example.com/x", "//example.com/x", "mailto:a@b.c", "#section"]);
    });

    it("does nothing when the page carries no session token", () => {
      expect(propagate("http://127.0.0.1:41001/note/A.md", ["B.md"])).toEqual(["B.md"]);
    });
  });
});

/**
 * Audit 20260906 — MCP-C05: cookies are scoped by HOST, not by port, so two
 * workspace servers on 127.0.0.1 shared one cookie name and the second to
 * authenticate logged the first one out.
 */
describe("per-workspace cookie identity (audit 20260906)", () => {
  it("gives two workspace roots different cookie names", async () => {
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-srv-b-"));
    try {
      await write("note.md", "a\n");
      await fs.writeFile(path.join(otherRoot, "note.md"), "b\n");

      const a = await makeServer();
      const bIndex = await buildIndex(otherRoot);
      const b = createContentServer({
        root: otherRoot,
        bootstrapToken: BOOTSTRAP,
        getIndex: () => bIndex,
      });

      const nameOf = async (app: import("hono").Hono) => {
        const mint = await app.request("/__mint", {
          headers: { authorization: `Bearer ${BOOTSTRAP}` },
        });
        const { nonce } = (await mint.json()) as { nonce: string };
        const res = await app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
        return /(vmark_cs_session[^=]*)=/.exec(res.headers.get("set-cookie") ?? "")![1];
      };

      expect(await nameOf(a.app)).not.toBe(await nameOf(b.app));
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  // Derived from the root rather than random, so restarting a workspace
  // REPLACES its cookie instead of leaving another one in the jar.
  it("gives the same workspace the same cookie name across restarts", async () => {
    await write("note.md", "a\n");
    const nameOf = async () => {
      const server = await makeServer();
      const mint = await server.app.request("/__mint", {
        headers: { authorization: `Bearer ${BOOTSTRAP}` },
      });
      const { nonce } = (await mint.json()) as { nonce: string };
      const res = await server.app.request(`/__auth?t=${nonce}`, { redirect: "manual" });
      return /(vmark_cs_session[^=]*)=/.exec(res.headers.get("set-cookie") ?? "")![1];
    };

    expect(await nameOf()).toBe(await nameOf());
  });

  it("still authenticates with its own namespaced cookie", async () => {
    await write("note.md", "hello\n");
    const server = await makeServer();
    const cookie = await authedCookie(server.app);

    const res = await server.app.request("/note/note.md", { headers: { cookie } });
    expect(res.status).toBe(200);
  });
});

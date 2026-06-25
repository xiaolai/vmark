// Phase 1/4 — live HTTP: real socket, cookie handshake over the wire, port-file,
// watcher-driven index refresh. (Server-half evidence for spike S0.1.)
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startKbServer, type RunningKbServer } from "./runtime";
import { SESSION_COOKIE } from "./auth";

let root: string;
let server: RunningKbServer | null = null;
const BOOTSTRAP = "live-token-xyz";

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

/** Mint a nonce over the wire, bootstrap, return the session Cookie header. */
async function liveCookie(url: string): Promise<string> {
  const mint = await fetch(`${url}/__mint`, { headers: { authorization: `Bearer ${BOOTSTRAP}` } });
  const { nonce } = (await mint.json()) as { nonce: string };
  const boot = await fetch(`${url}/__auth?t=${nonce}`, { redirect: "manual" });
  const setCookie = boot.headers.get("set-cookie") ?? "";
  return `${SESSION_COOKIE}=${new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)![1]}`;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-live-"));
});
afterEach(async () => {
  if (server) await server.close();
  server = null;
  await fs.rm(root, { recursive: true, force: true });
});

describe("startKbServer — live over a real socket", () => {
  it("binds loopback, writes a port-file, and gates with the cookie", async () => {
    await write("Home.md", "# Home\n\n[[Note]]");
    await write("Note.md", "note body");
    const portFile = path.join(root, ".port.json");
    server = await startKbServer({ root, bootstrapToken: BOOTSTRAP, portFile });

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain("127.0.0.1");

    // Port-file written with port + token.
    const pf = JSON.parse(await fs.readFile(portFile, "utf8"));
    expect(pf).toMatchObject({ port: server.port, token: BOOTSTRAP });

    // Unauthenticated → 401.
    const unauth = await fetch(`${server.url}/__health`);
    expect(unauth.status).toBe(401);

    // Mint nonce (Bearer) → bootstrap → cookie.
    const cookie = await liveCookie(server.url);

    // Authenticated note render over the wire.
    const note = await fetch(`${server.url}/note/Home.md`, { headers: { cookie } });
    expect(note.status).toBe(200);
    const html = await note.text();
    expect(html).toContain("<h1>Home</h1>");
    expect(html).toContain('href="/note/Note.md"');
  });

  it("refreshes the index after a file is added (watcher)", async () => {
    await write("A.md", "a");
    server = await startKbServer({ root, bootstrapToken: BOOTSTRAP });
    const cookie = await liveCookie(server.url);

    const before = (await (await fetch(`${server.url}/__health`, { headers: { cookie } })).json()) as { docs: number };
    expect(before.docs).toBe(1);

    await write("B.md", "b");
    // Wait for the debounced watcher rebuild.
    await new Promise((r) => setTimeout(r, 600));

    const after = (await (await fetch(`${server.url}/__health`, { headers: { cookie } })).json()) as { docs: number };
    expect(after.docs).toBe(2);
  });
});

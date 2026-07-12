// WI-2.3 — injected act scripts: snapshot / click / type by role+name, run via eval
import { describe, it, expect } from "vitest";
import { buildSnapshotScript, buildClickScript, buildTypeScript } from "./actScript";

/** Execute a generated agent script against an HTML fixture (as the page would). */
function run(html: string, script: string): unknown {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // The script body ends with `return JSON.stringify(...)`, mirroring how the
  // driver's callAsyncJavaScript evaluates it with `document` in scope.
  const fn = new Function("document", script);
  return JSON.parse(fn(doc) as string);
}

describe("buildSnapshotScript", () => {
  it("extracts interactive/structural elements with role + name", () => {
    const snap = run(
      `<h1>Welcome</h1><button>Publish</button><a href="/x">More</a><p>ignored</p>`,
      buildSnapshotScript(),
    ) as Array<{ role: string; name: string }>;
    const byRole = Object.fromEntries(snap.map((n) => [n.role, n.name]));
    expect(byRole.heading).toBe("Welcome");
    expect(byRole.button).toBe("Publish");
    expect(byRole.link).toBe("More");
    expect(snap.some((n) => n.role === "generic")).toBe(false);
  });
});

describe("buildClickScript", () => {
  it("clicks the element matching role + name and reports success", () => {
    const doc = new DOMParser().parseFromString(
      `<body><button id="b">Publish</button></body>`,
      "text/html",
    );
    let clicked = false;
    doc.getElementById("b")!.addEventListener("click", () => (clicked = true));
    const fn = new Function("document", buildClickScript("button", "Publish"));
    const res = JSON.parse(fn(doc) as string) as { found: boolean; clicked: boolean };
    expect(res.found).toBe(true);
    expect(res.clicked).toBe(true);
    expect(clicked).toBe(true);
  });

  it("reports not-found when no element matches", () => {
    const res = run(`<button>Cancel</button>`, buildClickScript("button", "Publish")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });

  it("does not cross role boundaries (a link named Publish is not a button)", () => {
    const res = run(`<a href="/x">Publish</a>`, buildClickScript("button", "Publish")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });
});

describe("buildTypeScript", () => {
  it("sets an input's value and fires input/change events", () => {
    const doc = new DOMParser().parseFromString(
      `<body><label for="e">Email</label><input id="e" type="text"></body>`,
      "text/html",
    );
    const input = doc.getElementById("e") as HTMLInputElement;
    let inputEvents = 0;
    input.addEventListener("input", () => (inputEvents += 1));
    const fn = new Function("document", buildTypeScript("textbox", "Email", "hi@example.com"));
    const res = JSON.parse(fn(doc) as string) as { found: boolean; typed: boolean };
    expect(res.found).toBe(true);
    expect(res.typed).toBe(true);
    expect(input.value).toBe("hi@example.com");
    expect(inputEvents).toBeGreaterThan(0);
  });

  it("reports not-found for a missing field", () => {
    const res = run(`<input type="text" aria-label="Other">`, buildTypeScript("textbox", "Name", "x")) as {
      found: boolean;
    };
    expect(res.found).toBe(false);
  });
});

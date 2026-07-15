// WI-2.2 — agent perception: ARIA role inference, accessible name, snapshot, locators
import { describe, it, expect } from "vitest";
import { computeRole, accessibleName, ariaSnapshot, queryByRole } from "./aria";

function el(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return doc.body.firstElementChild as HTMLElement;
}
function root(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}

describe("computeRole", () => {
  it("infers roles from tag and attributes", () => {
    expect(computeRole(el(`<button>x</button>`))).toBe("button");
    expect(computeRole(el(`<a href="/x">x</a>`))).toBe("link");
    expect(computeRole(el(`<a>no href</a>`))).toBeNull(); // anchor w/o href is not a link
    expect(computeRole(el(`<input type="text">`))).toBe("textbox");
    expect(computeRole(el(`<input type="checkbox">`))).toBe("checkbox");
    expect(computeRole(el(`<input type="submit">`))).toBe("button");
    expect(computeRole(el(`<textarea></textarea>`))).toBe("textbox");
    expect(computeRole(el(`<h2>t</h2>`))).toBe("heading");
    expect(computeRole(el(`<nav></nav>`))).toBe("navigation");
    expect(computeRole(el(`<img alt="a">`))).toBe("img");
    expect(computeRole(el(`<select></select>`))).toBe("combobox");
  });

  it("honors an explicit role attribute over the implicit one", () => {
    expect(computeRole(el(`<div role="button">x</div>`))).toBe("button");
  });

  it("maps range inputs to slider and hidden inputs to no role", () => {
    expect(computeRole(el(`<input type="range">`))).toBe("slider");
    expect(computeRole(el(`<input type="hidden">`))).toBeNull();
  });

  it("maps number to spinbutton and search to searchbox (not textbox)", () => {
    expect(computeRole(el(`<input type="number">`))).toBe("spinbutton");
    expect(computeRole(el(`<input type="search">`))).toBe("searchbox");
  });

  it("treats role as a token list — the first token wins", () => {
    expect(computeRole(el(`<div role="button link">x</div>`))).toBe("button");
    expect(computeRole(el(`<div role="  BUTTON  ">x</div>`))).toBe("button");
  });

  it("drops presentational roles (they carry no semantics)", () => {
    expect(computeRole(el(`<div role="presentation">x</div>`))).toBeNull();
    expect(computeRole(el(`<img role="none" alt="deco">`))).toBeNull();
  });

  it("maps a multiple/sized select to listbox, not combobox", () => {
    expect(computeRole(el(`<select multiple></select>`))).toBe("listbox");
    expect(computeRole(el(`<select size="4"></select>`))).toBe("listbox");
    expect(computeRole(el(`<select size="1"></select>`))).toBe("combobox");
  });
});

describe("accessibleName", () => {
  it("prefers aria-label", () => {
    expect(accessibleName(el(`<button aria-label="Close dialog">x</button>`))).toBe("Close dialog");
  });
  it("uses the button/link text when no aria-label", () => {
    expect(accessibleName(el(`<button>  Publish  </button>`))).toBe("Publish");
    expect(accessibleName(el(`<a href="/x">Read more</a>`))).toBe("Read more");
  });
  it("uses img alt text", () => {
    expect(accessibleName(el(`<img src="/x.png" alt="Company logo">`))).toBe("Company logo");
  });
  it("uses an associated <label for> for inputs", () => {
    const r = root(`<label for="e">Email</label><input id="e" type="text">`);
    const input = r.querySelector("input")!;
    expect(accessibleName(input)).toBe("Email");
  });
  it("falls back to placeholder for an unlabeled input", () => {
    expect(accessibleName(el(`<input type="text" placeholder="Search…">`))).toBe("Search…");
  });
  it("resolves aria-labelledby to the referenced element text", () => {
    const r = root(`<span id="lbl">Save changes</span><button aria-labelledby="lbl">x</button>`);
    expect(accessibleName(r.querySelector("button")!)).toBe("Save changes");
  });

  it("prefers aria-labelledby OVER aria-label (WAI-ARIA precedence)", () => {
    // aria-labelledby outranks aria-label; taking aria-label here would name the
    // control wrong and could target a different element.
    const r = root(
      `<span id="ref">Referenced name</span><button aria-labelledby="ref" aria-label="Direct name">x</button>`,
    );
    expect(accessibleName(r.querySelector("button")!)).toBe("Referenced name");
  });

  it("falls back to aria-label when aria-labelledby resolves to nothing", () => {
    const r = root(`<button aria-labelledby="missing" aria-label="Fallback name">x</button>`);
    expect(accessibleName(r.querySelector("button")!)).toBe("Fallback name");
  });

  it("uses a wrapping <label> when there is no `for`", () => {
    const r = root(`<label>Full name <input type="text"></label>`);
    expect(accessibleName(r.querySelector("input")!)).toBe("Full name");
  });

  it("uses the value of a submit input", () => {
    expect(accessibleName(el(`<input type="submit" value="Send it">`))).toBe("Send it");
  });

  it("falls back to the title attribute for a roled element with no text", () => {
    expect(accessibleName(el(`<div role="button" title="Helpful tip"></div>`))).toBe("Helpful tip");
  });

  it("returns empty string when no name is derivable", () => {
    expect(accessibleName(el(`<input type="text">`))).toBe("");
  });

  it("returns empty for a control the platform associates no labels with", () => {
    // A hidden input exposes `labels === null` — the label lookup must not throw.
    expect(accessibleName(el(`<input type="hidden" value="csrf">`))).toBe("");
  });

  it("uses alt for an image input button", () => {
    expect(accessibleName(el(`<input type="image" src="/go.png" alt="Search">`))).toBe("Search");
  });

  it("concatenates multiple associated labels in document order", () => {
    const r = root(`<label for="e">Email</label><input id="e" type="text"><label for="e">(work)</label>`);
    expect(accessibleName(r.querySelector("input")!)).toBe("Email (work)");
  });

  it("normalizes whitespace in every name source, not just text-derived ones", () => {
    expect(accessibleName(el(`<button aria-label="Close\n  dialog">x</button>`))).toBe(
      "Close dialog",
    );
    expect(accessibleName(el(`<input type="text" placeholder="Search\tthe   docs">`))).toBe(
      "Search the docs",
    );
    expect(accessibleName(el(`<input type="submit" value="Send\n it">`))).toBe("Send it");
    expect(accessibleName(el(`<div role="button" title="Helpful\n tip"></div>`))).toBe(
      "Helpful tip",
    );
  });
});

describe("queryByRole", () => {
  const page = root(`
    <nav><a href="/">Home</a></nav>
    <main>
      <h1>Title</h1>
      <button>Cancel</button>
      <button>Publish</button>
      <button aria-label="Publish now">Go</button>
      <a href="/next">Publish</a>
    </main>`);

  it("finds elements by role", () => {
    expect(queryByRole(page, "button")).toHaveLength(3);
    expect(queryByRole(page, "heading")).toHaveLength(1);
  });

  it("filters by exact accessible name (default)", () => {
    const btns = queryByRole(page, "button", { name: "Publish" });
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("Publish");
  });

  it("does not cross role boundaries (a link named Publish is not a button)", () => {
    expect(queryByRole(page, "button", { name: "Publish" })).toHaveLength(1);
    expect(queryByRole(page, "link", { name: "Publish" })).toHaveLength(1);
  });

  it("supports substring name matching", () => {
    // "Publish", "Publish now" both contain "Publish"
    expect(queryByRole(page, "button", { name: "Publish", exact: false })).toHaveLength(2);
  });

  it("returns [] when nothing matches", () => {
    expect(queryByRole(page, "button", { name: "Nonexistent" })).toEqual([]);
  });

  it("SECURITY-OF-TARGETING: never returns a hidden element before the visible control", () => {
    const r = root(`
      <div hidden><button>Publish</button></div>
      <div aria-hidden="true"><button>Publish</button></div>
      <div style="display: none"><button>Publish</button></div>
      <div inert><button>Publish</button></div>
      <button id="real">Publish</button>`);
    const found = queryByRole(r, "button", { name: "Publish" });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("real");
  });

  it("excludes elements hidden by their own attributes / inline style", () => {
    const r = root(`<button hidden>A</button><button style="visibility: hidden">B</button>`);
    expect(queryByRole(r, "button")).toEqual([]);
  });
});

describe("ariaSnapshot", () => {
  it("produces role+name nodes for interesting elements, skipping generic containers", () => {
    const page = root(`
      <div><span>plain text</span></div>
      <h1>Welcome</h1>
      <button>OK</button>
      <a href="/x">link</a>`);
    const snap = ariaSnapshot(page);
    const roles = snap.map((n) => n.role);
    expect(roles).toContain("heading");
    expect(roles).toContain("button");
    expect(roles).toContain("link");
    expect(roles).not.toContain("generic");
    const heading = snap.find((n) => n.role === "heading");
    expect(heading?.name).toBe("Welcome");
    expect(heading?.level).toBe(1);
  });

  it("reports state for form controls", () => {
    const page = root(`<input type="checkbox" checked aria-label="Agree"><button disabled>Save</button>`);
    const snap = ariaSnapshot(page);
    const checkbox = snap.find((n) => n.role === "checkbox");
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.name).toBe("Agree");
    const button = snap.find((n) => n.role === "button");
    expect(button?.disabled).toBe(true);
  });

  it("reads ARIA state attributes (aria-checked, aria-disabled, aria-level)", () => {
    const page = root(`
      <div role="checkbox" aria-checked="true" aria-label="Terms"></div>
      <div role="button" aria-disabled="true">Blocked</div>
      <div role="heading" aria-level="3">Custom heading</div>`);
    const snap = ariaSnapshot(page);
    expect(snap.find((n) => n.role === "checkbox")?.checked).toBe(true);
    expect(snap.find((n) => n.role === "button")?.disabled).toBe(true);
    expect(snap.find((n) => n.role === "heading")?.level).toBe(3);
  });

  it("reports the LIVE checked state after user interaction, not the initial attribute", () => {
    const page = root(`
      <input type="checkbox" checked aria-label="Was checked">
      <input type="checkbox" aria-label="Was unchecked">`);
    const [initiallyChecked, initiallyUnchecked] = Array.from(
      page.querySelectorAll("input"),
    ) as HTMLInputElement[];
    // The user clicks both: the attribute never moves, the property does.
    initiallyChecked.checked = false;
    initiallyUnchecked.checked = true;

    const snap = ariaSnapshot(page);
    expect(snap.find((n) => n.name === "Was checked")?.checked).toBe(false);
    expect(snap.find((n) => n.name === "Was unchecked")?.checked).toBe(true);
  });

  it("reports a control disabled by an ancestor <fieldset> as disabled", () => {
    const page = root(`<fieldset disabled><button>Save</button></fieldset>`);
    expect(ariaSnapshot(page).find((n) => n.role === "button")?.disabled).toBe(true);
  });

  it("honors a bare `disabled` attribute on a custom control", () => {
    const page = root(`<div role="button" disabled>Custom</div>`);
    expect(ariaSnapshot(page).find((n) => n.role === "button")?.disabled).toBe(true);
  });

  it("omits hidden elements and their subtrees", () => {
    const page = root(`
      <div aria-hidden="true"><h1>Hidden headline</h1></div>
      <h1>Real headline</h1>`);
    const snap = ariaSnapshot(page);
    expect(snap.map((n) => n.name)).toEqual(["Real headline"]);
  });

  it("stamps each node with a stable ref that survives repeated snapshots (WI-P2.1)", () => {
    const page = root(`<h1>Title</h1><button>OK</button><a href="/x">Link</a>`);
    const first = ariaSnapshot(page);
    expect(first.every((n) => /^e\d+$/.test(n.ref))).toBe(true);
    // Re-reading the SAME document must not move any node's ref.
    const second = ariaSnapshot(page);
    expect(second.map((n) => n.ref)).toEqual(first.map((n) => n.ref));
  });

  it("restarts refs for a freshly parsed document, never leaking across pages (WI-P2.1)", () => {
    const p1 = root(`<button>A</button>`);
    const p2 = root(`<button>B</button>`);
    // Each document has its own store, so a navigation cannot carry a ref across.
    expect(ariaSnapshot(p1)[0].ref).toBe("e1");
    expect(ariaSnapshot(p2)[0].ref).toBe("e1");
  });
});

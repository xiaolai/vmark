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
});

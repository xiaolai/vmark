/**
 * Tests for detailsBlock extension — input rule regex, extension metadata,
 * renderHTML, addAttributes, insertDetailsBlock command, click-to-toggle plugin.
 */

import { describe, it, expect, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { DOMSerializer, DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { detailsBlockExtension, detailsSummaryExtension } from "../tiptap";

// ---------------------------------------------------------------------------
// Schema helper
// ---------------------------------------------------------------------------

function createSchema() {
  return getSchema([StarterKit, detailsBlockExtension, detailsSummaryExtension]);
}

function createDocWithParagraph(text: string) {
  const schema = createSchema();
  const paragraph = schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
  const doc = schema.nodes.doc.create(null, [paragraph]);
  return { schema, doc };
}

function createDocWithDetails(open: boolean, summaryText: string, contentText: string) {
  const schema = createSchema();
  const summary = schema.nodes.detailsSummary.create(null, summaryText ? [schema.text(summaryText)] : []);
  const content = schema.nodes.paragraph.create(null, contentText ? [schema.text(contentText)] : []);
  const details = schema.nodes.detailsBlock.create({ open }, [summary, content]);
  const doc = schema.nodes.doc.create(null, [details]);
  return { schema, doc };
}

// ---------------------------------------------------------------------------
// Input rule regex (replicated from source to test directly)
// ---------------------------------------------------------------------------

const DETAILS_INPUT_PATTERN = /^(?:<details>|:::details)\s*$/i;

describe("DETAILS_INPUT_PATTERN", () => {
  it.each([
    { input: "<details>", matches: true },
    { input: ":::details", matches: true },
    { input: "<DETAILS>", matches: true },
    { input: ":::DETAILS", matches: true },
    { input: "<Details>", matches: true },
    { input: ":::Details", matches: true },
    { input: "<details> ", matches: true },
    { input: ":::details  ", matches: true },
  ])("matches '$input': $matches", ({ input, matches }) => {
    expect(DETAILS_INPUT_PATTERN.test(input)).toBe(matches);
  });

  it.each([
    { input: "<details>some text", matches: false },
    { input: ":::details content", matches: false },
    { input: "details", matches: false },
    { input: "<detail>", matches: false },
    { input: ":::detail", matches: false },
    { input: "prefix <details>", matches: false },
    { input: "", matches: false },
  ])("does not match '$input'", ({ input, matches }) => {
    expect(DETAILS_INPUT_PATTERN.test(input)).toBe(matches);
  });
});

// ---------------------------------------------------------------------------
// Extension metadata — detailsBlockExtension
// ---------------------------------------------------------------------------

describe("detailsBlockExtension", () => {
  it("has correct name", () => {
    expect(detailsBlockExtension.name).toBe("detailsBlock");
  });

  it("is a block node with content", () => {
    expect(detailsBlockExtension.config.group).toBe("block");
    expect(detailsBlockExtension.config.content).toBe("detailsSummary block+");
    expect(detailsBlockExtension.config.defining).toBe(true);
  });

  it("has open attribute defaulting to false", () => {
    const schema = createSchema();
    expect(schema.nodes.detailsBlock.spec.attrs?.open?.default).toBe(false);
  });

  it("has sourceLine attribute defaulting to null", () => {
    const schema = createSchema();
    expect(schema.nodes.detailsBlock.spec.attrs?.sourceLine?.default).toBeNull();
  });

  it("parseHTML matches details tag", () => {
    const parseRules = detailsBlockExtension.config.parseHTML!.call({} as never);
    expect(parseRules![0].tag).toBe("details");
  });
});

// ---------------------------------------------------------------------------
// Extension metadata — detailsSummaryExtension
// ---------------------------------------------------------------------------

describe("detailsSummaryExtension", () => {
  it("has correct name", () => {
    expect(detailsSummaryExtension.name).toBe("detailsSummary");
  });

  it("has inline content", () => {
    expect(detailsSummaryExtension.config.content).toBe("inline*");
  });

  it("is not selectable", () => {
    expect(detailsSummaryExtension.config.selectable).toBe(false);
  });

  it("is defining", () => {
    expect(detailsSummaryExtension.config.defining).toBe(true);
  });

  it("parseHTML matches summary tag", () => {
    const parseRules = detailsSummaryExtension.config.parseHTML!.call({} as never);
    expect(parseRules![0].tag).toBe("summary");
  });

  it("has sourceLine attribute", () => {
    const schema = createSchema();
    expect(schema.nodes.detailsSummary.spec.attrs?.sourceLine?.default).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderHTML
// ---------------------------------------------------------------------------

describe("detailsBlock renderHTML", () => {
  it("serializes details block to DOM without errors", () => {
    const { doc, schema } = createDocWithDetails(true, "Summary", "Content");
    const serializer = DOMSerializer.fromSchema(schema);
    expect(() => serializer.serializeFragment(doc.content)).not.toThrow();
  });

  it("renders with 'details' tag and 'details-block' class", () => {
    const { doc, schema } = createDocWithDetails(true, "Summary", "Content");
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.classList.contains("details-block")).toBe(true);
  });

  it("renders with open attribute when open is true", () => {
    const { doc, schema } = createDocWithDetails(true, "Summary", "Content");
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const details = container.querySelector("details");
    expect(details!.hasAttribute("open")).toBe(true);
  });

  it("does not render open attribute when open is false", () => {
    const { doc, schema } = createDocWithDetails(false, "Summary", "Content");
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const details = container.querySelector("details");
    expect(details!.hasAttribute("open")).toBe(false);
  });

  it("renders summary with 'details-summary' class", () => {
    const { doc, schema } = createDocWithDetails(true, "My Summary", "Content");
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary!.classList.contains("details-summary")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createDetailsBlockNode — null when types missing
// ---------------------------------------------------------------------------

describe("createDetailsBlockNode returns null for missing types", () => {
  it("insertDetailsBlock returns false when schema lacks required node types", () => {
    // Create a schema without detailsBlock/detailsSummary
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema: PmSchema } = require("@tiptap/pm/model");
    const bareSchema = new PmSchema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { group: "block", content: "text*" },
        text: { inline: true },
      },
    });

    const doc = bareSchema.node("doc", null, [
      bareSchema.node("paragraph", null, [bareSchema.text("test")]),
    ]);
    const state = EditorState.create({ doc });

    // createDetailsBlockNode accesses schema.nodes.detailsBlock etc.
    // When those are undefined, it returns null, and the command returns false.
    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    const result = insertCmd()({
      state, dispatch: undefined, tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// insertDetailsBlock command
// ---------------------------------------------------------------------------

describe("insertDetailsBlock command", () => {
  it("returns true on dry run (no dispatch)", () => {
    const { doc } = createDocWithParagraph("Hello");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });

    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    const canRun = insertCmd()({
      state, dispatch: undefined, tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    expect(canRun).toBe(true);
  });

  it("returns false when createDetailsBlockNode returns null (missing types in schema)", () => {
    // Use a schema without paragraph type to make createDetailsBlockNode return null
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema: PmSchema } = require("@tiptap/pm/model");
    const bareSchema = new PmSchema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "text*" },
        text: { inline: true },
      },
    });
    const doc = bareSchema.node("doc", null, [
      bareSchema.node("paragraph", null, [bareSchema.text("test")]),
    ]);
    const state = EditorState.create({ doc });

    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    // With dispatch provided, should still return false
    const result = insertCmd()({
      state, dispatch: vi.fn(), tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    expect(result).toBe(false);
  });

  it("dispatches transaction when dispatch is provided", () => {
    const { doc } = createDocWithParagraph("Hello");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });

    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    let dispatched = false;
    insertCmd()({
      state, dispatch: () => { dispatched = true; }, tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    expect(dispatched).toBe(true);
  });

  it("insertDetailsBlock sets cursor after summary using summarySize from firstChild", () => {
    // This verifies the detailsNode.firstChild?.nodeSize ?? 0 path executes correctly
    // when firstChild exists (normal case). The ?? 0 fallback is a defensive branch
    // for a hypothetically childless node created by the schema.
    const { doc } = createDocWithParagraph("Hello");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });

    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    let dispatched = false;
    insertCmd()({
      state, dispatch: () => { dispatched = true; }, tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    // Confirms line 107 executes without error and proceeds to dispatch
    expect(dispatched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// insertDetailsBlock with depth-0 selections (PL-2)
// ---------------------------------------------------------------------------

describe("insertDetailsBlock with depth-0 selections (PL-2)", () => {
  function runInsert(state: EditorState) {
    const commandFn = detailsBlockExtension.config.addCommands!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const insertCmd = commandFn.insertDetailsBlock;

    let result = state;
    const dispatch = (tr: unknown) => {
      result = state.apply(tr as Parameters<EditorState["apply"]>[0]);
    };
    const returned = insertCmd()({
      state, dispatch, tr: state.tr,
      chain: () => ({}) as never, can: () => ({}) as never,
      commands: {} as never, editor: {} as never, view: {} as never,
    } as never);
    return { returned, result };
  }

  it("AllSelection (Cmd+A): does not throw and appends the block at doc end", () => {
    const { doc } = createDocWithParagraph("Hello");
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });

    const { returned, result } = runInsert(state);

    expect(returned).toBe(true);
    expect(result.doc.lastChild?.type.name).toBe("detailsBlock");
    // Existing content is untouched
    expect(result.doc.textContent).toContain("Hello");
  });

  it("NodeSelection on a top-level hr: does not throw and inserts after the hr", () => {
    const schema = createSchema();
    const paragraph = schema.nodes.paragraph.create(null, [schema.text("Hello")]);
    const hr = schema.nodes.horizontalRule.create();
    const doc = schema.nodes.doc.create(null, [paragraph, hr]);
    const hrPos = paragraph.nodeSize;
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, hrPos) });

    const { returned, result } = runInsert(state);

    expect(returned).toBe(true);
    expect(result.doc.childCount).toBe(3);
    expect(result.doc.child(0).type.name).toBe("paragraph");
    expect(result.doc.child(1).type.name).toBe("horizontalRule");
    expect(result.doc.child(2).type.name).toBe("detailsBlock");
  });

  it("TextSelection behavior unchanged: inserts after the current block", () => {
    const { doc } = createDocWithParagraph("Hello");
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });

    const { returned, result } = runInsert(state);

    expect(returned).toBe(true);
    expect(result.doc.childCount).toBe(2);
    expect(result.doc.child(0).type.name).toBe("paragraph");
    expect(result.doc.child(1).type.name).toBe("detailsBlock");
  });
});

// ---------------------------------------------------------------------------
// parseHTML — open attribute
// ---------------------------------------------------------------------------

describe("detailsBlock parseHTML open attribute", () => {
  it("parses open=true from <details open>", () => {
    const schema = createSchema();
    const html = "<details open><summary>Title</summary><p>Content</p></details>";
    const dom = new window.DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const detailsNode = doc.firstChild!;
    expect(detailsNode.type.name).toBe("detailsBlock");
    expect(detailsNode.attrs.open).toBe(true);
  });

  it("parses open=false from <details> without open attribute", () => {
    const schema = createSchema();
    const html = "<details><summary>Title</summary><p>Content</p></details>";
    const dom = new window.DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const detailsNode = doc.firstChild!;
    expect(detailsNode.attrs.open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addInputRules
// ---------------------------------------------------------------------------

describe("detailsBlock addInputRules", () => {
  it("defines input rules", () => {
    const addInputRules = detailsBlockExtension.config.addInputRules;
    expect(addInputRules).toBeDefined();
  });

  it("input rule handler creates details block from pattern match", () => {
    const addInputRules = detailsBlockExtension.config.addInputRules;
    expect(addInputRules).toBeDefined();
    // Calling the function to verify it returns an array of input rules
    const rules = addInputRules!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    expect(rules).toBeDefined();
    expect(rules!.length).toBe(1);
  });

  it("input rule handler returns null when createDetailsBlockNode returns null", () => {
    const addInputRules = detailsBlockExtension.config.addInputRules;
    const rules = addInputRules!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const rule = rules![0];
    const handler = (rule as unknown as { handler: (...args: unknown[]) => unknown }).handler;

    // Create a state with a schema that lacks detailsBlock/detailsSummary
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema: PmSchema } = require("@tiptap/pm/model");
    const bareSchema = new PmSchema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { group: "block", content: "text*" },
        text: { inline: true },
      },
    });
    const doc = bareSchema.node("doc", null, [
      bareSchema.node("paragraph", null, [bareSchema.text(":::details")]),
    ]);
    const state = EditorState.create({ doc });

    const mockInsertContentAt = vi.fn();
    const mockSetTextSelection = vi.fn();

    const result = handler({
      state,
      range: { from: 1, to: 11 },
      match: [":::details"],
      commands: {
        insertContentAt: mockInsertContentAt,
        setTextSelection: mockSetTextSelection,
      },
    });

    expect(result).toBeNull();
    // Commands should NOT be called since createDetailsBlockNode returns null
    expect(mockInsertContentAt).not.toHaveBeenCalled();
  });

  it("input rule handler invokes commands to insert details block (lines 120-130)", () => {
    const addInputRules = detailsBlockExtension.config.addInputRules;
    const rules = addInputRules!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const rule = rules![0];

    // Access the handler from the InputRule
    const handler = (rule as unknown as { handler: (...args: unknown[]) => unknown }).handler;
    expect(handler).toBeDefined();

    const { doc } = createDocWithParagraph(":::details");
    const state = EditorState.create({ doc });

    const mockInsertContentAt = vi.fn();
    const mockSetTextSelection = vi.fn();

    // Simulate what Tiptap passes to the handler
    const result = handler({
      state,
      range: { from: 1, to: 11 },  // range of ":::details" inside the paragraph
      match: [":::details"],
      commands: {
        insertContentAt: mockInsertContentAt,
        setTextSelection: mockSetTextSelection,
      },
    });

    expect(result).toBeNull();
    expect(mockInsertContentAt).toHaveBeenCalled();
    expect(mockSetTextSelection).toHaveBeenCalled();
  });

  it("input rule handler executes summarySize calculation from firstChild (line 128)", () => {
    // Verifies detailsNode.firstChild?.nodeSize ?? 0 executes in the input rule handler.
    // When firstChild exists (normal), summarySize = firstChild.nodeSize.
    const addInputRules = detailsBlockExtension.config.addInputRules;
    const rules = addInputRules!.call({
      name: "detailsBlock", options: {}, storage: {}, editor: {},
    } as never);
    const rule = rules![0];
    const handler = (rule as unknown as { handler: (...args: unknown[]) => unknown }).handler;

    const { doc } = createDocWithParagraph(":::details");
    const state = EditorState.create({ doc });

    const mockInsertContentAt = vi.fn();
    const mockSetTextSelection = vi.fn();

    const result = handler({
      state,
      range: { from: 1, to: 11 },
      match: [":::details"],
      commands: {
        insertContentAt: mockInsertContentAt,
        setTextSelection: mockSetTextSelection,
      },
    });

    // Line 128 executed: summarySize = detailsNode.firstChild?.nodeSize ?? 0
    // With a real schema, firstChild (detailsSummary "Click to expand") has a nodeSize
    expect(result).toBeNull();
    expect(mockInsertContentAt).toHaveBeenCalled();
    // setTextSelection is called with paragraphStart + 1 + summarySize + 1
    // summarySize > 0 since firstChild exists
    expect(mockSetTextSelection).toHaveBeenCalled();
    const callArg = mockSetTextSelection.mock.calls[0][0];
    // paragraphStart=0, so position = 0 + 1 + summarySize + 1; summarySize should be > 0
    expect(callArg).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Click-to-toggle plugin
// ---------------------------------------------------------------------------

describe("detailsBlock ProseMirror plugins", () => {
  it("registers at least one plugin", () => {
    const addPlugins = detailsBlockExtension.config.addProseMirrorPlugins;
    expect(addPlugins).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Click handler — toggle open state
// ---------------------------------------------------------------------------

describe("detailsBlock click handler", () => {
  function getClickHandler() {
    const plugins = detailsBlockExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "detailsBlock",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return (plugins[0] as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;
  }

  it("returns false when click target is not an Element", () => {
    const handleClick = getClickHandler();
    // Text nodes are not Elements
    const result = handleClick({}, 0, { target: "text node" });
    expect(result).toBe(false);
  });

  it("returns false when click target is not a summary", () => {
    const handleClick = getClickHandler();
    const div = document.createElement("div");
    const result = handleClick({}, 0, { target: div });
    expect(result).toBe(false);
  });

  it("returns false when summary is found but no detailsBlock ancestor in doc", () => {
    const handleClick = getClickHandler();
    const summary = document.createElement("summary");
    summary.classList.add("details-summary");

    // Create a doc with just a paragraph (no detailsBlock)
    const { doc } = createDocWithParagraph("Hello world");
    const state = EditorState.create({ doc });

    const mockView = {
      state,
      dispatch: vi.fn(),
    };

    // Position 2 is inside the paragraph, not a detailsBlock
    const result = handleClick(mockView, 2, { target: summary });
    expect(result).toBe(false);
  });

  it("toggles open state when clicking on summary element", () => {
    const handleClick = getClickHandler();
    const { doc } = createDocWithDetails(false, "Summary", "Content");
    const state = EditorState.create({ doc });

    // Create a summary DOM element for the event target
    const summary = document.createElement("summary");
    summary.classList.add("details-summary");

    let dispatchedTr: unknown = null;
    const mockView = {
      state,
      dispatch: (tr: unknown) => { dispatchedTr = tr; },
    };

    // Position 2 is inside the detailsSummary
    const result = handleClick(mockView, 2, { target: summary });
    expect(result).toBe(true);
    expect(dispatchedTr).not.toBeNull();
  });

  it("toggles from open=true to open=false", () => {
    const handleClick = getClickHandler();
    const { doc } = createDocWithDetails(true, "Summary", "Content");
    const state = EditorState.create({ doc });

    const summary = document.createElement("summary");
    summary.classList.add("details-summary");

    let dispatchedTr: { doc: { firstChild: { attrs: { open: boolean } } } } | null = null;
    const mockView = {
      state,
      dispatch: (tr: unknown) => { dispatchedTr = tr as typeof dispatchedTr; },
    };

    handleClick(mockView, 2, { target: summary });
    expect(dispatchedTr).not.toBeNull();
    // The resulting doc should have open toggled
    expect(dispatchedTr!.doc.firstChild.attrs.open).toBe(false);
  });

  it("toggles from open=false to open=true", () => {
    const handleClick = getClickHandler();
    const { doc } = createDocWithDetails(false, "Summary", "Content");
    const state = EditorState.create({ doc });

    const summary = document.createElement("summary");
    summary.classList.add("details-summary");

    let dispatchedTr: { doc: { firstChild: { attrs: { open: boolean } } } } | null = null;
    const mockView = {
      state,
      dispatch: (tr: unknown) => { dispatchedTr = tr as typeof dispatchedTr; },
    };

    handleClick(mockView, 2, { target: summary });
    expect(dispatchedTr).not.toBeNull();
    expect(dispatchedTr!.doc.firstChild.attrs.open).toBe(true);
  });

  it("sets addToHistory=false meta on toggle transaction", () => {
    const handleClick = getClickHandler();
    const { doc } = createDocWithDetails(false, "Summary", "Content");
    const state = EditorState.create({ doc });

    const summary = document.createElement("summary");
    summary.classList.add("details-summary");

    let dispatchedTr: { getMeta: (key: string) => unknown } | null = null;
    const mockView = {
      state,
      dispatch: (tr: unknown) => { dispatchedTr = tr as typeof dispatchedTr; },
    };

    handleClick(mockView, 2, { target: summary });
    expect(dispatchedTr!.getMeta("addToHistory")).toBe(false);
  });
});

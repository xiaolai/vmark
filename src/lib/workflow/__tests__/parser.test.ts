// @vitest-environment node
import { parseWorkflow, isWorkflowYaml, WorkflowParseError, WorkflowValidationError } from "../parser";

// ============================================================================
// Minimal Parsing
// ============================================================================

describe("parseWorkflow", () => {
  it("parses minimal workflow (name + 1 step)", () => {
    const yaml = `
name: Test Workflow
steps:
  - id: step1
    uses: genie/summarize
`;
    const graph = parseWorkflow(yaml);
    expect(graph.name).toBe("Test Workflow");
    expect(graph.steps).toHaveLength(1);
    expect(graph.steps[0].id).toBe("step1");
    expect(graph.steps[0].uses).toBe("genie/summarize");
    expect(graph.steps[0].type).toBe("genie");
    expect(graph.steps[0].label).toBe("step1");
  });

  it("parses workflow with description", () => {
    const yaml = `
name: My Workflow
description: A workflow that does things
steps:
  - uses: action/read-file
    with:
      path: ./notes/
`;
    const graph = parseWorkflow(yaml);
    expect(graph.description).toBe("A workflow that does things");
  });

  it("auto-generates ID from uses when id is absent", () => {
    const yaml = `
name: Test
steps:
  - uses: genie/summarize
`;
    const graph = parseWorkflow(yaml);
    expect(graph.steps[0].id).toBe("summarize");
    expect(graph.steps[0].label).toBe("summarize");
  });

  // ============================================================================
  // Step Type Derivation
  // ============================================================================

  describe("step type derivation", () => {
    it.each([
      { uses: "genie/summarize", type: "genie", icon: "🤖" },
      { uses: "genie/translate", type: "genie", icon: "🤖" },
      { uses: "action/read-file", type: "action", icon: "📂" },
      { uses: "action/save-file", type: "action", icon: "📤" },
      { uses: "action/read-folder", type: "action", icon: "📂" },
      { uses: "action/notify", type: "action", icon: "🔔" },
      { uses: "action/copy", type: "action", icon: "📋" },
      { uses: "action/prompt", type: "action", icon: "💬" },
      { uses: "webhook/stripe.invoice", type: "webhook", icon: "🌐" },
      { uses: "webhook/sendgrid.send", type: "webhook", icon: "🌐" },
    ])("$uses → type=$type, icon=$icon", ({ uses, type, icon }) => {
      const yaml = `
name: Test
steps:
  - id: s1
    uses: ${uses}
`;
      const graph = parseWorkflow(yaml);
      expect(graph.steps[0].type).toBe(type);
      expect(graph.steps[0].icon).toBe(icon);
    });
  });

  // ============================================================================
  // Edge Computation
  // ============================================================================

  describe("edge computation", () => {
    it("creates sequential edges when needs is absent", () => {
      const yaml = `
name: Test
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
  - id: c
    uses: action/save-file
`;
      const graph = parseWorkflow(yaml);
      expect(graph.edges).toEqual([
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ]);
    });

    it("creates edges from needs declarations", () => {
      const yaml = `
name: Test
steps:
  - id: read
    uses: action/read-folder
  - id: summarize
    uses: genie/summarize
    needs: read
  - id: translate
    uses: genie/translate
    needs: read
  - id: save
    uses: action/save-files
    needs: [summarize, translate]
`;
      const graph = parseWorkflow(yaml);
      expect(graph.edges).toContainEqual({ source: "read", target: "summarize" });
      expect(graph.edges).toContainEqual({ source: "read", target: "translate" });
      expect(graph.edges).toContainEqual({ source: "summarize", target: "save" });
      expect(graph.edges).toContainEqual({ source: "translate", target: "save" });
      expect(graph.edges).toHaveLength(4);
    });

    it("first step with no needs has no incoming edges", () => {
      const yaml = `
name: Test
steps:
  - id: first
    uses: action/read-file
`;
      const graph = parseWorkflow(yaml);
      expect(graph.edges).toHaveLength(0);
    });
  });

  // ============================================================================
  // Full Workflow Features
  // ============================================================================

  it("parses env, defaults, and triggers", () => {
    const yaml = `
name: Full Workflow
on:
  manual: true
  schedule:
    - cron: '0 9 * * 1'
env:
  MODEL: claude-sonnet-4-6
defaults:
  model: claude-sonnet-4-6
  approval: ask
steps:
  - id: s1
    uses: genie/summarize
`;
    const graph = parseWorkflow(yaml);
    expect(graph.triggers).toContainEqual({ type: "manual" });
    expect(graph.triggers).toContainEqual({ type: "schedule", cron: "0 9 * * 1" });
    expect(graph.env).toEqual({ MODEL: "claude-sonnet-4-6" });
    expect(graph.defaults.model).toBe("claude-sonnet-4-6");
    expect(graph.defaults.approval).toBe("ask");
  });

  it("parses step with matrix, if, limits, approval, model", () => {
    const yaml = `
name: Full
steps:
  - id: translate
    uses: genie/translate
    if: summarize.output.length > 100
    model: claude-opus-4-6
    approval: ask
    limits:
      timeout: 5m
      max_tokens: 4096
      max_cost: "$2.00"
    matrix:
      language: [chinese, japanese, korean]
    with:
      input: summarize.output
`;
    const graph = parseWorkflow(yaml);
    const step = graph.steps[0];
    expect(step.condition).toBe("summarize.output.length > 100");
    expect(step.model).toBe("claude-opus-4-6");
    expect(step.approval).toBe("ask");
    expect(step.limits).toEqual({ timeout: "5m", maxTokens: 4096, maxCost: "$2.00" });
    expect(step.matrix).toEqual({ language: ["chinese", "japanese", "korean"] });
    expect(step.with).toEqual({ input: "summarize.output" });
  });

  it("parses with values as strings", () => {
    const yaml = `
name: Test
steps:
  - id: s1
    uses: genie/summarize
    with:
      input: read.output
      language: chinese
`;
    const graph = parseWorkflow(yaml);
    expect(graph.steps[0].with).toEqual({ input: "read.output", language: "chinese" });
  });

  // ============================================================================
  // Source Ranges
  // ============================================================================

  it("tracks source line ranges for each step", () => {
    const yaml = `name: Test
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
`;
    const graph = parseWorkflow(yaml);
    expect(graph.steps[0].sourceRange).toBeDefined();
    expect(graph.steps[0].sourceRange!.startLine).toBeGreaterThan(0);
    expect(graph.steps[1].sourceRange).toBeDefined();
    expect(graph.steps[1].sourceRange!.startLine).toBeGreaterThan(
      graph.steps[0].sourceRange!.startLine
    );
  });

  // ============================================================================
  // Unicode / CJK
  // ============================================================================

  it("handles Unicode step IDs and CJK content", () => {
    const yaml = `
name: CJK测试
steps:
  - id: 读取文件
    uses: action/read-folder
    with:
      path: ./笔记/
`;
    const graph = parseWorkflow(yaml);
    expect(graph.name).toBe("CJK测试");
    expect(graph.steps[0].id).toBe("读取文件");
    expect(graph.steps[0].with.path).toBe("./笔记/");
  });

  // ============================================================================
  // Error Cases
  // ============================================================================

  describe("error handling", () => {
    it("throws WorkflowParseError for malformed YAML", () => {
      const yaml = `
name: Test
steps:
  - id: a
    uses action/read  # missing colon
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowParseError);
    });

    it("throws WorkflowValidationError for missing name", () => {
      const yaml = `
steps:
  - id: a
    uses: action/read-file
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });

    it("throws WorkflowValidationError for empty steps", () => {
      const yaml = `
name: Test
steps: []
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });

    it("throws WorkflowValidationError for missing steps", () => {
      const yaml = `
name: Test
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });

    it("throws WorkflowValidationError for step without uses", () => {
      const yaml = `
name: Test
steps:
  - id: a
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });

    it("throws WorkflowValidationError for duplicate step IDs", () => {
      const yaml = `
name: Test
steps:
  - id: a
    uses: action/read-file
  - id: a
    uses: genie/summarize
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
      try {
        parseWorkflow(yaml);
      } catch (e) {
        expect((e as WorkflowValidationError).stepId).toBe("a");
      }
    });

    it("throws WorkflowValidationError for missing dependency reference", () => {
      const yaml = `
name: Test
steps:
  - id: a
    uses: action/read-file
  - id: b
    uses: genie/summarize
    needs: nonexistent
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });

    it("throws WorkflowValidationError for circular dependencies", () => {
      const yaml = `
name: Test
steps:
  - id: a
    uses: action/read-file
    needs: b
  - id: b
    uses: genie/summarize
    needs: a
`;
      expect(() => parseWorkflow(yaml)).toThrow(WorkflowValidationError);
    });
  });
});

// ============================================================================
// isWorkflowYaml Heuristic
// ============================================================================

describe("isWorkflowYaml", () => {
  it("returns true for valid workflow YAML", () => {
    expect(isWorkflowYaml(`
name: Test
steps:
  - uses: genie/summarize
`)).toBe(true);
  });

  it("returns true for workflow with steps and uses", () => {
    expect(isWorkflowYaml(`
steps:
  - id: a
    uses: action/read-file
`)).toBe(true);
  });

  it("returns false for random YAML", () => {
    expect(isWorkflowYaml(`
server:
  port: 3000
  host: localhost
`)).toBe(false);
  });

  it("returns false for non-YAML strings", () => {
    expect(isWorkflowYaml("hello world")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isWorkflowYaml("")).toBe(false);
  });

  it("returns false for YAML with steps but no uses", () => {
    expect(isWorkflowYaml(`
steps:
  - id: a
    command: echo hello
`)).toBe(false);
  });
});

/**
 * Tests for mermaid plugin utilities.
 *
 * Note: Tests for renderMermaid require DOM and are in the security tests.
 */

import { describe, it, expect } from "vitest";
import { isMermaidSyntax } from "./index";

describe("mermaid plugin", () => {
  describe("isMermaidSyntax", () => {
    describe("flowcharts", () => {
      it("recognizes graph syntax", () => {
        expect(isMermaidSyntax("graph TD\n  A --> B")).toBe(true);
        expect(isMermaidSyntax("graph LR\n  Start --> End")).toBe(true);
        expect(isMermaidSyntax("graph TB\n  A[Square] --> B(Round)")).toBe(true);
      });

      it("recognizes flowchart syntax", () => {
        expect(isMermaidSyntax("flowchart TD\n  A --> B")).toBe(true);
        expect(isMermaidSyntax("flowchart LR\n  Start --> End")).toBe(true);
      });
    });

    describe("sequence diagrams", () => {
      it("recognizes sequenceDiagram", () => {
        expect(isMermaidSyntax("sequenceDiagram\n  Alice->>Bob: Hello")).toBe(true);
        expect(
          isMermaidSyntax("sequenceDiagram\n  participant A\n  A->>B: Message")
        ).toBe(true);
      });
    });

    describe("class diagrams", () => {
      it("recognizes classDiagram", () => {
        expect(isMermaidSyntax("classDiagram\n  Animal <|-- Dog")).toBe(true);
        expect(
          isMermaidSyntax("classDiagram\n  class BankAccount {\n    +balance\n  }")
        ).toBe(true);
      });
    });

    describe("state diagrams", () => {
      it("recognizes stateDiagram", () => {
        expect(isMermaidSyntax("stateDiagram\n  [*] --> State1")).toBe(true);
        expect(isMermaidSyntax("stateDiagram-v2\n  [*] --> State1")).toBe(true);
      });
    });

    describe("entity relationship diagrams", () => {
      it("recognizes erDiagram", () => {
        expect(isMermaidSyntax("erDiagram\n  CUSTOMER ||--o{ ORDER")).toBe(true);
      });
    });

    describe("gantt charts", () => {
      it("recognizes gantt", () => {
        expect(
          isMermaidSyntax("gantt\n  title Project\n  section Phase 1")
        ).toBe(true);
      });
    });

    describe("pie charts", () => {
      it("recognizes pie", () => {
        expect(isMermaidSyntax('pie title Pets\n  "Dogs" : 45')).toBe(true);
        expect(isMermaidSyntax("pie\n  title Distribution")).toBe(true);
      });
    });

    describe("git graphs", () => {
      it("recognizes gitGraph", () => {
        expect(isMermaidSyntax("gitGraph\n  commit")).toBe(true);
        expect(isMermaidSyntax("gitGraph\n  branch develop")).toBe(true);
      });
    });

    describe("mindmaps", () => {
      it("recognizes mindmap", () => {
        expect(isMermaidSyntax("mindmap\n  root((Root))")).toBe(true);
      });
    });

    describe("timeline", () => {
      it("recognizes timeline", () => {
        expect(isMermaidSyntax("timeline\n  title History")).toBe(true);
      });
    });

    describe("quadrant charts", () => {
      it("recognizes quadrantChart", () => {
        expect(
          isMermaidSyntax(
            "quadrantChart\n  title Analytics\n  x-axis Low --> High"
          )
        ).toBe(true);
      });
    });

    describe("XY charts", () => {
      it("recognizes xychart", () => {
        expect(
          isMermaidSyntax('xychart-beta\n  title "Sales"\n  x-axis [jan, feb]')
        ).toBe(true);
      });
    });

    describe("block diagrams", () => {
      it("recognizes block-beta", () => {
        expect(isMermaidSyntax("block-beta\n  columns 3")).toBe(true);
      });
    });

    describe("packet diagrams", () => {
      it("recognizes packet-beta", () => {
        expect(isMermaidSyntax("packet-beta\n  title Packet")).toBe(true);
      });
    });

    describe("kanban", () => {
      it("recognizes kanban", () => {
        expect(isMermaidSyntax("kanban\n  todo")).toBe(true);
      });
    });

    describe("architecture diagrams", () => {
      it("recognizes architecture-beta", () => {
        expect(isMermaidSyntax("architecture-beta\n  service db")).toBe(true);
      });
    });

    describe("directives", () => {
      it("recognizes mermaid directives", () => {
        expect(isMermaidSyntax("%%{init: {'theme': 'dark'}}%%\ngraph TD")).toBe(
          true
        );
        expect(
          isMermaidSyntax("%%{ init: { 'logLevel': 'debug' } }%%\nflowchart LR")
        ).toBe(true);
      });
    });

    describe("non-mermaid content", () => {
      it("returns false for plain text", () => {
        expect(isMermaidSyntax("Hello world")).toBe(false);
        expect(isMermaidSyntax("This is some text")).toBe(false);
      });

      it("returns false for code that looks similar but isn't mermaid", () => {
        expect(isMermaidSyntax("const graph = new Graph()")).toBe(false);
        expect(isMermaidSyntax("function flowchart()")).toBe(false);
      });

      it("returns false for empty content", () => {
        expect(isMermaidSyntax("")).toBe(false);
        expect(isMermaidSyntax("   ")).toBe(false);
      });

      it("returns false for JavaScript code", () => {
        expect(isMermaidSyntax("const x = 1;\nconsole.log(x);")).toBe(false);
      });

      it("returns false for HTML", () => {
        expect(isMermaidSyntax("<div>Content</div>")).toBe(false);
      });

      it("returns false for markdown", () => {
        expect(isMermaidSyntax("# Heading\n\nParagraph")).toBe(false);
      });
    });

    describe("whitespace handling", () => {
      it("handles leading whitespace", () => {
        expect(isMermaidSyntax("  graph TD\n  A --> B")).toBe(true);
        expect(isMermaidSyntax("\n\ngraph TD")).toBe(true);
        expect(isMermaidSyntax("\t\tflowchart LR")).toBe(true);
      });

      it("handles trailing whitespace", () => {
        expect(isMermaidSyntax("graph TD  \n")).toBe(true);
        expect(isMermaidSyntax("pie   ")).toBe(true);
      });
    });
  });
});

// @vitest-environment node
// workflow.apply_patch answers the FIRST refusal in a fixed order when several apply at once — addresses, patch shape, tab, tab kind, revision, patch application — and every refusal leaves the buffer, the revision and the journal untouched. Edge cases: a malformed set with a malformed batch, a malformed batch on a markdown or unknown tab, an unknown tab with a stale revision, a markdown tab with a stale revision, a stale revision over unparseable text, unparseable text with an ill-formed value, a no-op batch at the current revision
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { deriveFormatId } from "@/stores/tabStoreHelpers";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { handleWorkflowApplyPatch } from "@/services/mcpBridge/v2/workflow";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { respond } from "@/services/mcpBridge/utils";
import { agentJournalFake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const WORKFLOW = "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo 你好\n";
const BROKEN = "name: [\n";

function seed(tabId: string, filePath: string, content: string) {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: tabId, filePath, title: tabId, isPinned: false, formatId: deriveFormatId(filePath) }] },
    activeTabId: { main: tabId },
    untitledCounter: 0,
  });
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(tabId, content, filePath);
}

const rename = (value: string) => [{ kind: "workflow.set", path: "name", value }];

type Row = [name: string, tab: "yaml" | "broken" | "markdown", args: Record<string, unknown>, expected: string];

const ROWS: Row[] = [
  ["a malformed set before a malformed batch", "yaml", { addresses: "x", patches: "x" }, "INVALID_ADDRESSES"],
  ["a malformed batch before a markdown tab", "markdown", { patches: [{ kind: "nope" }] }, "INVALID_PATCH"],
  ["a malformed batch before an unknown tab", "yaml", { tabId: "missing", patches: "x" }, "INVALID_PATCH"],
  ["an unknown tab before a stale revision", "yaml", { tabId: "missing", expected_revision: "rev-old", patches: rename("x") }, "INVALID_TAB"],
  ["a markdown tab before a stale revision", "markdown", { expected_revision: "rev-old", patches: rename("x") }, "NOT_WORKFLOW"],
  ["a stale revision before unparseable text", "broken", { expected_revision: "rev-old", patches: rename("x") }, "STALE"],
  ["unparseable text before an ill-formed value", "broken", { patches: rename("a\uD800") }, "INVALID_PATCH"],
];

function lastAnswer() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

describe("workflow.apply_patch refusal order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentJournalFake.reset();
  });

  it.each(ROWS)("%s", async (_name, tab, args, expected) => {
    const [id, path, content] =
      tab === "markdown" ? ["t-md", "/tmp/笔记.md", "# hi\n"] : ["t-yaml", "/repo/.github/workflows/ci.yml", tab === "broken" ? BROKEN : WORKFLOW];
    seed(id, path, content);
    const revision = useRevisionStore.getState().getRevision(id);

    await handleWorkflowApplyPatch("req", args, TEST_WRITE_CONTEXT);

    const answer = lastAnswer();
    expect(answer.success).toBe(false);
    expect(JSON.parse(answer.error ?? "{}")).toMatchObject({ error: expected });
    expect(useDocumentStore.getState().documents[id].content).toBe(content);
    expect(useRevisionStore.getState().getRevision(id)).toBe(revision);
    expect(agentJournalFake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("answers a no-op batch at the current revision with that revision, journaling nothing", async () => {
    seed("t-yaml", "/repo/.github/workflows/ci.yml", WORKFLOW);
    const revision = useRevisionStore.getState().getRevision("t-yaml");
    await handleWorkflowApplyPatch("req", { expected_revision: revision, patches: rename("ci") }, TEST_WRITE_CONTEXT);
    expect(lastAnswer()).toEqual({ id: "req", success: true, data: { revision } });
    expect(agentJournalFake.prepareControlledWrite).not.toHaveBeenCalled();
  });
});

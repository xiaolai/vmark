/**
 * Store seeding for the `useExternalFileChanges` suites.
 *
 * Purpose: put one tab and its document into the real stores, built from the
 * REAL constructors — `DocumentTab` and `createInitialDocument` — rather than
 * from object literals that restate their fields.
 *
 * Why it exists: the suite has been split three ways (the base file, `.media`,
 * `.deletion`) and each split copied the seeding helper with it. Every copy
 * spelled `Tab` and `DocumentState` out by hand, so every copy fell behind the
 * real types the moment either gained a property — four of them
 * (`selectedText`, `readOnly`, `hasBom`, `mode`) plus a `closedTabs` key the
 * tab store no longer has. That went unnoticed because test files were not
 * typechecked until `lint:test-types`, and a mock that does not match its
 * subject still satisfies a test written against the mock.
 *
 * Deriving from the constructors makes the drift impossible instead of
 * detectable: a new field on either type arrives here automatically, and one
 * definition cannot disagree with itself.
 *
 * The vitest MOCKS are deliberately not here — `vi.mock` hoists per module, so
 * each suite must declare its own. Only the store state is shared.
 *
 * @coordinates-with stores/documentStore/documentState.ts — createInitialDocument
 * @coordinates-with stores/tabStoreTypes.ts — DocumentTab
 * @module test/externalFileChangesFixtures
 */

import { useDocumentStore } from "@/stores/documentStore";
import { createInitialDocument } from "@/stores/documentStore/documentState";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";

const SEEDED_TAB_ID = "tab-1";
const SEEDED_PATH = "/workspace/test.md";
const SEEDED_CONTENT = "# old content";

export interface SeedOptions {
  isMissing?: boolean;
  isDirty?: boolean;
  lastDiskContent?: string;
  /** Defaults to the seeded workspace path. */
  filePath?: string;
  /** Defaults to `"markdown"`; pass `"media"` for a binary tab. */
  formatId?: string;
  /** Defaults to the seeded tab id. */
  tabId?: string;
}

/** Seed one tab + document into the real stores. Returns the tab id. */
export function seedTabAndDocument(options: SeedOptions = {}): string {
  const {
    isMissing = false,
    isDirty = false,
    lastDiskContent,
    filePath = SEEDED_PATH,
    formatId = "markdown",
    tabId = SEEDED_TAB_ID,
  } = options;

  const tab: DocumentTab = {
    id: tabId,
    kind: "document",
    title: filePath.split("/").pop() ?? filePath,
    filePath,
    isPinned: false,
    formatId,
  };
  useTabStore.setState({
    tabs: { main: [tab] },
    activeTabId: { main: tabId },
    untitledCounter: 0,
  });

  // A media document's bytes never enter the store, so its content is empty by
  // construction; a text document gets a body so a reload is observable.
  const body = formatId === "media" ? "" : SEEDED_CONTENT;
  const doc = createInitialDocument(body, filePath);
  useDocumentStore.setState({
    documents: {
      [tabId]: {
        ...doc,
        isDirty,
        isMissing,
        ...(lastDiskContent === undefined ? {} : { lastDiskContent }),
      },
    },
  });
  return tabId;
}

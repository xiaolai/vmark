# Manual Testing Guide

Open the comprehensive testing guide and help the user test VMark features.

## Instructions

1. Read the testing guide at `dev-docs/testing/comprehensive-testing-guide.md` (create the directory if it does not yet exist)
2. Present a summary of test categories to the user
3. If the user specifies a category, show those specific tests
4. Help track test results if requested

## Test Categories

1. **Text Formatting** - Bold, italic, code, strikethrough, nested marks
2. **Atomic Nodes** - Footnote and math selection behavior
3. **Mode Switching** - Cursor sync between WYSIWYG and Source (F7)
4. **File Operations** - New, open, save, save as, close
5. **Auto-Save** - Automatic saving with configurable interval
6. **Document History** - Version history, revert, pruning
7. **UI Components** - Status bar, sidebar, title bar
8. **Slash Menu** - "/" trigger menu for block insertion
9. **Search** - Find and replace (Cmd+F)
10. **Focus/Typewriter** - Focus mode (F8), Typewriter mode (F9)
11. **Settings** - Themes, fonts, CJK options
12. **Unicode** - CJK text, emoji, special characters
13. **Popups** - Link, image, footnote popups
14. **Images** - Paste, drag-drop, context menu
15. **Code/Diagrams** - Code blocks, LaTeX, Mermaid

## Quick Start

Ask the user which category they want to test, then:
1. Show the relevant test cases from the guide
2. Help them execute tests if app is running (use Tauri MCP)
3. Record results

## Files

- Main guide: `dev-docs/testing/comprehensive-testing-guide.md`
- Cursor sync details: `dev-docs/testing/cursor-sync-manual-testing.md`
- Atomic node details: `dev-docs/testing/atomic-node-selection-testing.md`
- Auto-save details: `dev-docs/testing/auto-save-history-testing.md`

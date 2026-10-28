# Export Edit History to Git

VMark keeps an edit history for every document: each save and each edit an AI client makes through MCP is recorded, with who made it. **File → Document History → Export Edit History to Git…** copies that history into a Git repository, so you can browse it with `git log`, diff it, or keep it with your project.

## How to export

1. Open the document whose history you want.
2. Choose **File → Document History → Export Edit History to Git…** (or run *Export Edit History to Git* from the command palette).
3. Pick a folder inside the Git repository. The picker opens in the document's own folder.

VMark tells you how many commits it added, or that the branch was already up to date.

## What the branch holds

The history goes to its own branch, `vmark-journal/<document-uuid>`. VMark never touches your working tree, your index, `HEAD`, or any other branch, and it does not switch branches. The branch holds one file, named after the document.

- **One commit per revision.** Its author is whoever made the edit (you, or the AI client), and its date is the time of the edit.
- **One summary commit per stretch of pruned history.** VMark prunes old revisions to keep its history small. A run of pruned revisions becomes a single commit named *Collected history*, listing everyone who edited in that stretch.

Each commit message ends with trailers that tie it back to VMark:

| Trailer | Meaning |
|---------|---------|
| `VMark-Document` | The document's identity, the same in every commit |
| `VMark-Revision` | The revision this commit records |
| `VMark-Parent` | The revision before it |
| `VMark-Actor` | Who made the edit |
| `VMark-Kind` | How it was recorded: `controlled` (an AI edit through VMark), `observed` (a save), `gap` (a change made outside VMark), and others |
| `VMark-Tool` | The MCP tool behind an AI edit |
| `VMark-Session`, `VMark-Client` | The AI client's session label and name, when it gave them |
| `VMark-Collected` | On a summary commit: the range of pruned revisions it covers |
| `VMark-Actors` | On a summary commit: everyone who edited in that range, sorted |

## Exporting again

Export as often as you like. A second export adds only the revisions made since the last one; when nothing is new, it changes nothing. The same history always produces the same commits.

VMark refuses, rather than overwrites, when the branch is not what it left there:

- **The branch changed since the last export** (someone committed to it, rewound it, or rewrote it). Move or delete the branch, then export again.
- **A branch with that name exists but is not VMark's export of this document.**
- **The branch is checked out** in a worktree.

## Requirements and limits

- Git must be installed. VMark looks for it on your login shell's `PATH`; if it is missing, the export says so.
- Only saved history is exported. Edits you have not saved yet are not part of it.
- VMark creates commits with Git's low-level commands, so commit hooks do not run. Hooks that watch branch updates do run.
- A large history takes a while: each commit costs a few Git processes.
- In a shallow clone, VMark only continues a branch it exported itself from this computer.
- Do not check out the export branch while exporting. Checkout after the final worktree check can leave that worktree's index and files inconsistent with its moved branch.

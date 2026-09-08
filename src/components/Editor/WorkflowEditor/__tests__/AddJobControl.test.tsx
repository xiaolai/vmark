// Audit R2 (#581) — the "Add job" prompt.
//
// The field had no accessible name (a placeholder is not a label) and every
// rejection was SILENT: an id that duplicated an existing job, or one GitHub
// Actions cannot accept, simply did nothing on Enter while the Add button sat
// disabled with no reason given. The rule was also written twice — once in
// `submit`, once in the `disabled` expression — so the two could disagree.
//
// The real workflow store, per the mock-boundary policy: queued patches are
// what "the job was created" means here.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useWorkflowStore } from "@/stores/workflowStore";
import { AddJobControl, jobIdProblem } from "../AddJobControl";

beforeEach(() => {
  useWorkflowStore.getState().resetEdit();
});

const queued = () => useWorkflowStore.getState().edit.pendingPatches;

async function openPrompt(existing: string[] = ["build"]) {
  const user = userEvent.setup();
  render(<AddJobControl existingIds={existing} />);
  await user.click(screen.getByRole("button", { name: /add job/i }));
  return { user, field: screen.getByRole("textbox", { name: /new job id/i }) };
}

describe("jobIdProblem", () => {
  it("says nothing about an empty draft — the user has not typed yet", () => {
    expect(jobIdProblem("", ["build"])).toBeNull();
    expect(jobIdProblem("   ", ["build"])).toBeNull();
  });

  it("names the duplicate and the malformed cases apart", () => {
    expect(jobIdProblem("build", ["build"])).toBe("duplicate");
    expect(jobIdProblem("1job", ["build"])).toBe("invalid");
    expect(jobIdProblem("my job", ["build"])).toBe("invalid");
    expect(jobIdProblem("deploy", ["build"])).toBeNull();
    expect(jobIdProblem("_deploy-2", ["build"])).toBeNull();
  });
});

describe("AddJobControl", () => {
  it("gives the field an accessible name, not just a placeholder", async () => {
    const { field } = await openPrompt();
    expect(field).toHaveAttribute("placeholder", "job-id");
    expect(field).toHaveAccessibleName(/new job id/i);
    expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it("says WHY a duplicate id is refused, and refuses it", async () => {
    const { user, field } = await openPrompt(["build"]);
    await user.type(field, "build");

    expect(field).toHaveAttribute("aria-invalid", "true");
    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent(/already exists/i);
    expect(field).toHaveAccessibleDescription(/already exists/i);
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(queued()).toHaveLength(0);
  });

  it("says WHY a malformed id is refused", async () => {
    const { user, field } = await openPrompt();
    await user.type(field, "1st job");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/letter or underscore/i);
    await user.keyboard("{Enter}");
    expect(queued()).toHaveLength(0);
  });

  it("queues the job and closes the prompt for a usable id", async () => {
    const { user, field } = await openPrompt();
    await user.type(field, "deploy");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.keyboard("{Enter}");

    expect(queued()).toEqual([{ kind: "job.create", jobId: "deploy" }]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Escape abandons the draft", async () => {
    const { user, field } = await openPrompt();
    await user.type(field, "deploy");
    await user.keyboard("{Escape}");

    expect(queued()).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

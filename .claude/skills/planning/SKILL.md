---
name: planning
description: Create comprehensive implementation plans and write them to plan files. Use when the user asks for a plan, comprehensive plan, systematic workflow design, or wants decisions documented in a plan file.
---

# Planning Skill

## When to use

Use this skill when the user asks for planning, a roadmap, a spec-to-implementation breakdown, or wants decisions documented.

## Modes

Choose the lightest mode that meets the request.

### `quick-plan`

Use when:
- task is small/medium and non-breaking
- no migrations and no multi-phase rollout

Output:
- 3–8 Work Items (WI-###), each with tests + acceptance

### `full-plan` (default)

Use when:
- migrations/persistence changes
- API/contract changes (public tools, schemas, SDKs)
- multi-phase roadmaps
- performance-sensitive work

Output:
- structured plan sections (see “Plan file template”)

## Process

1. **Clarify outcomes**
   - Restate desired behaviors and constraints.
   - Identify ambiguities and propose defaults if the user doesn’t decide.
   - Capture **constraints & dependencies** (runtime versions, OS, external services, feature flags, required tools).
   - **Capture gaps**: list requirement/behavior gaps or missing decisions revealed here.

2. **Inventory current behavior**
   - Trace entry points → state/store → side effects → persistence.
   - List key files/modules and the invariants they rely on.
   - Note ownership/priority rules (windows, workspaces, files).
   - **Capture gaps**: list where current behavior diverges from the stated outcomes.

3. **Define target rules**
   - Convert outcomes into explicit rules and precedence.
   - For each rule, include: trigger/context, expected behavior, scope, constraints, and exclusions.
   - **Edge-case pass**: cover empty/none, invalid/malformed, boundary sizes, conflicting state, multi-surface coordination, persistence/restore, and I/O failures.
   - **Capture gaps**: list rules that lack implementation support or current behavior conflicts.
   - Create a **Decision Log**:
     - decision, options considered, rationale, and why alternatives were rejected.
   - Create an **Open Questions** list:
     - questions that block correctness, who decides, and what the default is if not decided.

4. **Structure the plan**
   - Break into Work Items (WI-###), each with:
     - **Goal**
     - **Acceptance (measurable)** (correctness + performance + UX where relevant)
     - **Tests (first)** (file names + test intent; unit/integration/e2e as applicable)
     - **Touched areas** (file paths + key functions/classes/symbols)
     - **Dependencies** (other WIs, external tools/services)
     - **Risks + mitigations**
     - **Rollback / revert strategy**
   - Add **priority + estimates** (S/M/L) and explicit ordering/dependencies between WIs.
   - **Capture gaps**: map each gap to at least one WI (or record as “out of scope”).
   - **Plan lint (required)**:
     - Sections present (Outcomes, Constraints, Current Behavior, Target Rules, Work Items, Testing).
     - WI numbering is sequential and referenced consistently.
     - Every WI includes tests + acceptance.

5. **Write the plan file**
   - Use the template at `templates/TEMPLATE.md` (bundled with this skill) if available, otherwise follow the structure above.
   - Write plans to `dev-docs/plans/YYYYMMDD-HHMM-<topic>.md`.
   - Always report the saved plan path.

## Testing Requirements

- Every WI must include explicit tests to write **before** implementation (file names and test intent).
- If tests cannot be written, call it out explicitly and propose the smallest test seam to enable them.
- Include a **Testing Procedures** section in the plan with required commands and when to run them.
- End the plan with a short **Manual Test Checklist**.

## Acceptance Criteria Guidance

Acceptance must be **measurable and verifiable**:
- Good: “Search returns v1 schema with `locator_v1` for every result (unit test).”
- Bad: “Search feels better.”

## Plan → Verify Handoff (required)

At the end of the plan, include:
- Evidence to collect per WI (tests, logs, manual steps).
- Any required fixtures or sample data.

## Migration / persistence requirements (when applicable)

If the plan changes anything persisted (DB, on-disk cache, config files, APIs that clients store):

- Add a **Data Model** section (tables/columns/keys, versions).
- Add a **Migration Plan**:
  - forward migration steps
  - rollback steps
  - compatibility guarantees (old clients vs new server)
- Add **Invariants + validation queries** (what to check post-migration).
- Add a **Backfill / reindex** strategy if needed.

## Observability requirements (when applicable)

If the plan touches indexing/search/performance-sensitive paths:

- Define metrics (latency, throughput, memory, DB size growth).
- Define where logs go and how to enable verbose tracing.
- Add acceptance thresholds (e.g. “index 1000 docs < X minutes on machine Y”).

## Rollout requirements (when applicable)

If behavior changes are user-visible or risky:

- Add a **Rollout Plan** (feature flags, staged enablement, default-off vs default-on).
- Define “kill switch” conditions and how to revert quickly.

## Output Requirements

- Always produce a plan file and include its path in the response.
- Ask at most 1–2 clarifying questions only when they change the rules.

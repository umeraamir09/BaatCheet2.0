---
name: next-phase-spec
description: Find the next incomplete phase in specs/roadmap.md and scaffold its spec directory (requirements.md, plan.md, validation.md) under specs/YYYY-MM-DD-feature-name/. Use when the user says "next phase", "start the next phase", "scaffold the next phase", "set up phase N", "create the spec for the next phase", or otherwise asks to begin the spec workflow for an upcoming roadmap phase. Triggers the BaatCheet phase-spec workflow: roadmap scan, branch creation, 3 grouped questions, file generation. Use ONLY for the BaatCheet project's phased spec workflow; do not use for one-off features or non-roadmap work.
---

# Next Phase Spec

Scaffold the spec directory for the next incomplete roadmap phase. This is the BaatCheet phased-development workflow: each phase gets a dated spec directory with three files (`requirements.md`, `plan.md`, `validation.md`) that lock scope and decisions before implementation begins.

## When to use

Trigger when the user wants to start the next roadmap phase — "next phase", "set up phase 3", "scaffold the next phase", "create the spec for [phase]", etc. This skill handles the **spec scaffolding** (decisions + files), NOT the implementation. Implementation is a separate effort after the spec is reviewed and merged.

## Prerequisites (assert before proceeding)

- `specs/roadmap.md` exists and lists phases in order (Phase 0, 1, 2, ...).
- `specs/mission.md` and `specs/tech-stack.md` exist (read for guidance).
- At least one prior phase's spec directory exists under `specs/YYYY-MM-DD-*/` — use it as the structural template.
- The repo is a git repo (needed for branching).

If any prerequisite is missing, stop and tell the user what's missing.

## Workflow

### Step 1 — Find the next incomplete phase

1. Read `specs/roadmap.md`.
2. Walk phases in numeric order (Phase 0 → 1 → 2 → ...).
3. A phase is **complete** if its section header or the line below it contains `STATUS: COMPLETE` (case-insensitive). The first phase WITHOUT that marker is the next phase to scaffold.
4. Extract from that phase's roadmap section:
   - The phase number and name (e.g. "Phase 2 — Presence").
   - The **Goal** line.
   - The bullet list of scope items.
   - The **DoD** (definition of done) line.
5. If ALL phases are marked complete, stop and tell the user — there's no next phase.

### Step 2 — Create the feature branch

1. Check `git branch -a` and `git log --oneline -5` to understand the branch state.
2. Determine the base:
   - If the previous phase's branch exists (e.g. `phase-1/...` when starting Phase 2) and has NOT been merged to `main`, branch from that branch's tip (the prior phase's work is the foundation).
   - Otherwise branch from `main`.
3. Branch name format: `phase-<N>/<feature-name-kebab>` where `<N>` is the phase number and `<feature-name-kebab>` is a short kebab-case slug derived from the phase name (e.g. `phase-2/presence`, `phase-3/dm-text`, `phase-4/voice-1-1`, `phase-6/group-voice-livekit`).
4. Create and switch to the branch: `git checkout -b phase-<N>/<feature-name-kebab>`.

### Step 3 — Read context (do these in parallel)

Read all of these before forming questions:
- `specs/mission.md` — product constraints, non-goals, v1 decisions, the three loops.
- `specs/tech-stack.md` — stack choices and the reasoning behind each.
- The **previous phase's** `requirements.md`, `plan.md`, and `validation.md` — these are the structural template AND they record decisions that carry forward (look for "Decisions", "Out of scope — deferred", "NOT validated here" sections that point to later phases).
- Relevant codebase areas the new phase will touch (schema files, existing modules, etc.) — use `glob`/`grep`/`read` to ground the decisions in what actually exists. For Convex phases, read `convex/schema.ts` and relevant `convex/*.ts`. For frontend phases, read `src/` structure. For Rust/Tauri phases, read `src-tauri/src/`.

### Step 4 — Identify 3 consequential decisions and ask them in ONE question call

This is the core of the workflow. Do NOT skip this. Do NOT write any files before getting answers.

1. From the phase's goal/DoD + mission/tech-stack + previous phase's deferred items, identify the **3 most consequential decisions** that:
   - Are NOT already locked by `specs/mission.md`, `specs/tech-stack.md`, or `specs/roadmap.md`.
   - Shape the phase's implementation in a way that's hard to reverse later.
   - Have genuine alternatives worth presenting.
2. For each decision, frame a multiple-choice question:
   - `question`: one or two sentences stating the decision and the tradeoff/conflict that makes it non-obvious. Reference the roadmap/mission/stack constraint that creates the tension.
   - `header`: short label (max 30 chars).
   - `options`: 2-4 options. Put the **recommended** option first and append "(Recommended)" to its label. Each option's `description` explains the tradeoff concisely (what it costs, what it gives, what it defers).
3. Issue ALL 3 questions in a **single `question` tool call** (one `questions` array with 3 objects). This is mandatory — the user answers all three at once, not serially.
4. Wait for the answers. The user's choices become **locked decisions** (D1, D2, D3 ...) in `requirements.md`.

If you cannot find 3 genuine decisions (some phases may be more mechanical), still ask at least the decisions that matter — but aim for 3. Never ask zero questions.

### Step 5 — Derive the directory name and write the 3 files

Directory: `specs/<YYYY-MM-DD>-<feature-name-kebab>/`
- `<YYYY-MM-DD>` is today's date (use the env-provided date; format as ISO date).
- `<feature-name-kebab>` is the same slug used in the branch name (without the `phase-N/` prefix).

Write three files in that directory. Mirror the structure of the previous phase's spec files exactly — same section headings, same ordering, same tone. The sections below are the contract.

#### `requirements.md` — scope, decisions, context

```markdown
# Phase <N> — <Phase Name>: Requirements

Feature dir: `specs/<YYYY-MM-DD>-<feature-name>/`
Roadmap phase: **Phase <N> — <Phase Name>** (`specs/roadmap.md`)
Mission ref: `specs/mission.md` · Stack ref: `specs/tech-stack.md`
Builds on: `specs/<prev-dir>/` (Phase <N-1> — <one line on what carries forward>).

## Goal
<2-4 sentences. State what this phase proves/builds, tie it to the roadmap DoD, and note where it sits relative to prior phases.>

## In scope
- <Bullet list of what this phase delivers. Each bullet references a Decision (D1, D2, ...) where relevant. Be specific about data models, UI surfaces, lifecycle.>

## Out of scope (deferred — explicitly NOT Phase <N>)
- <Bullet list of what's NOT in this phase, each pointing to the later phase that will handle it (or "not in v1"). Mine the previous phase's "NOT validated here" and "Out of scope" sections for items that roll forward.>

## Decisions (locked for this phase)
- **D1 — <short title>.** <2-4 sentences: the choice, the rationale tied to mission/tech-stack/roadmap, and the key constraint that drove it. One decision per letter.>
- **D2 — ...**
- **D3 — ...**
<Continue D4, D5... as needed. The 3 user-answered questions are the core decisions; add any inherited/obvious decisions as additional letters.>

## Context
- `specs/mission.md` — <which mission constraints apply to this phase.>
- `specs/tech-stack.md` — <which stack rows apply.>
- `specs/roadmap.md` Phase <N-1> — <what it established that this phase builds on.>
- `specs/roadmap.md` Phase <N> DoD: *<quote the DoD verbatim>.*
- <Current codebase state relevant to this phase — e.g. "convex/schema.ts declares X; this phase adds Y".>

## User-performed prerequisites (not agent-executable)
- <Anything the user must do that the agent can't: create accounts, configure portals, run dev servers the agent can't reach, have test data/accounts ready. If none, state "None — the agent can execute all setup." but usually there's at least one.>
```

#### `plan.md` — numbered task groups

```markdown
# Phase <N> — <Phase Name>: Plan

Numbered task groups. Each is independently reviewable. Inherits Phase 0/1 conventions: Windows/PowerShell + `bun`, ESLint+Prettier, `bun run lint`/`bun run typecheck` gates, Convex `_generated/` gitignored (regen via `bunx convex dev`). Branch: `phase-<N>/<feature-name>`, off the Phase <N-1> tip.

## 1. <Task group title>
- 1.1 <Sub-task. Specific, actionable, references files/decisions.>
- 1.2 <...>
- **Done:** <one line stating the verifiable end state of this group.>

## 2. <Task group title>
- 2.1 <...>
- **Done:** <...>

<Continue 3, 4, 5... as needed. Typical phases have 5-8 task groups. The last group is always "Build + merge readiness":>

## <K>. Build + merge readiness
- <K>.1 `bun run lint` + `bun run typecheck` — clean.
- <K>.2 `bun tauri build` → release binary produced.
- <K>.3 Walk the manual smokes in `validation.md`: <list them by name>.
- <K>.4 Update `README.md` Phase <N> notes. Record a Phase <N> complete marker in `specs/roadmap.md` style with prior phases' precedent.
- **Done:** all validation in `validation.md` passes; phase ready to merge.
```

#### `validation.md` — how to know it succeeded

```markdown
# Phase <N> — <Phase Name>: Validation

How to know the implementation succeeded and can be merged. Per Decision D<K>, merge requires **automated gates green AND <N> manual smokes**.

## Automated gates (must all pass)
- [ ] `bun run lint` exits 0 — inherited.
- [ ] `bun run typecheck` exits 0 — inherited.
- [ ] `bun tauri build` completes and emits a release binary — inherited.
- [ ] <Phase-specific automated checks — e.g. schema deploys, no secrets in tree, grep assertions.>

## Manual smoke 1 — <name> (the Phase-<N> DoD <half/first half/etc.>)
1. <Numbered setup steps.>
2. <Action steps.>
- [ ] Pass: <one line stating the observable pass condition.>

## Manual smoke 2 — <name>
<...>

<Continue smokes as needed — typically 3-4. Each smoke maps to a DoD clause or a key decision.>

## Repo hygiene + Phase-<N>-specific checks
- [ ] <Bullet list of repo-hygiene and phase-specific assertions. Each is a single checkable item. Include: schema/table integrity checks, decision-specific assertions (e.g. "no extra Discord scopes" for auth phases), known-limitation documentation checks, and "Phase-0 remnant untouched if not relevant".>

## Explicitly NOT validated here (out of scope — later phases)
- ~~<item>~~ → Phase <M> (or "not in v1").
<Strike through items that roll forward to later phases, mined from the roadmap and the previous phase's "NOT validated here" section.>

## Merge criteria
All automated gates green + manual smokes 1–<N> passing + repo-hygiene + Phase-<N>-specific checks box-checked. Anything in the "NOT validated here" list is explicitly allowed to be absent. The Phase-<N> DoD from `specs/roadmap.md` is satisfied when <name which smokes satisfy the literal DoD>.
```

### Step 6 — Confirm and stop

After writing the 3 files:
1. Run `git status --short` and `git branch --show-current` to confirm the branch and the new files.
2. Report to the user: the branch name, the directory created, the 3 decisions locked (D1/D2/D3 with one-line summaries), and that the spec is ready for review. Do NOT commit — the user reviews first.
3. Do NOT proceed to implementation. The skill's job is scaffolding the spec; implementation is a separate effort the user initiates after reviewing.

## Critical rules

- **Never write files before the question call.** The 3 questions must be answered first; their answers become locked decisions.
- **Always ask exactly 3 questions in ONE `question` tool call** (one `questions` array, 3 objects). Not 1, not 2, not 4 — three, grouped. This is the user's explicit requirement.
- **Always put the recommended option first** in each question's options, with "(Recommended)" appended to its label.
- **Always branch before writing.** The spec files live on the phase branch, not on `main` or the previous phase's branch.
- **Always mirror the previous phase's file structure.** Read the prior phase's three files and match their section headings, ordering, and tone. The templates above are the contract; the prior phase is the style guide.
- **Always ground decisions in the actual codebase.** Read the relevant schema/source files before forming questions — don't ask about a "new table" if the table already exists; don't ask about a "new component" if one exists to extend.
- **Never commit.** The user reviews the spec and decides when to commit.
- **Never start implementation.** This skill scaffolds the spec only.

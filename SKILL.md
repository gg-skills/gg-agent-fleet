---
name: agent-fleet
description: when configuring Agent Fleet handoff task prompts — shell runners, logs directories, sequential/parallel command packs. MCP-compatible. Not for single-agent workflows.
---

# GG → Agent Fleet → Task Packs

> **Snapshot age:** live operational guidance. Verify the installed `agent` CLI
> flags and model IDs in the current workspace before producing commands.

## Overview

Use this skill to turn an immediate request, recent conversation context, gate report,
ESLint JSON output, test failure list, browser QA plan, documentation audit, or manual
scope inventory into **ready-to-run Agent Fleet task packs**: scoped prompt files,
executable Bash wrappers, output-log paths, and optional sequential or parallel run
scripts.

The output is not a prose plan. It is a durable handoff package that another
operator can run directly with the configured headless agent runtime. The current
implementation targets Cursor's `agent -p` CLI, but the skill name, output
folder, and package contracts use the runner-agnostic Agent Fleet vocabulary.
ESLint is one supported input route, not the only route.

For task schemas and command templates, see the local references listed in
[Local Corpus Layout](#local-corpus-layout).

## When to Use This Skill

**TRIGGER when:**
- The user asks to create Agent Fleet prompts, handoff tasks, or runnable agent
  task files.
- The user wants to split current lint, typecheck, test, migration, docs, audit,
  or cleanup work into bounded Agent Fleet jobs.
- The user wants Bash commands or scripts that run Agent Fleet tasks and save
  output logs under a timestamped `.tmp/` session folder.
- The user wants sequential or parallel Agent Fleet execution without using a
  formal orchestrator.
- The user asks for an agnostic template for generating Agent Fleet task packs
  from conversation context.
- **The user wants to brainstorm/analysis** a codebase system through multiple
  perspectives (load `references/brainstorming-workflow.md`):
  - Multi-wave analysis with diverse agent biases
  - Discovery of abstraction opportunities
  - System exploration without code changes
  - Cross-validated insights from different viewpoints

**SKIP when:**
- The user wants to run the underlying agent CLI directly rather than generate task packs.
- The task requires Taskplane dependency waves, reviews, and merge automation.
- The user only needs general Cursor CLI help; use the Cursor headless skill.
- The user wants generic prose handoff prompts that do not need executable agent
  runner scripts.

## Common Misconceptions

| # | Misconception | Correction | Key concept |
|---|---------------|------------|-------------|
| 1 | An Agent Fleet task is just a short instruction | It needs exact scope, constraints, context, verification, and output expectations | Runnable handoff |
| 2 | One prompt can safely fix many unrelated files | Prefer one task per file or tightly coupled file group to reduce conflicts | Bounded scope |
| 3 | Parallel agents can run without coordination | Parallelism needs conflict grouping, log files, and final verification | Execution hygiene |
| 4 | `tee` is optional when debugging | Use `tee` to both see output live and preserve logs | Reproducibility |
| 5 | Agents should commit when done | Generated tasks should default to no commit/no push unless the user explicitly requests otherwise | Human review |
| 6 | Session folders can be named arbitrarily | Always use `.tmp/YYYYMMDDTHHMMSS-agent-fleet-<slug>/` | Naming convention |

## Quick Commands

Load `references/quick-commands.md` when: you need the full set of session-dir,
generator, runner, and final-verification invocations to copy/paste.
Summary: a flat catalog of the most common Agent Fleet commands (session-dir
setup, CLI surface check, canonical `agent -p` invocation, Routes A/B/C
generator calls, high-concurrency JSDoc variant, pack-review helpers, and final
gate commands).

Most-used one-liner for a fresh session:

```bash
SESSION_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<purpose-slug>"
mkdir -p "$SESSION_DIR/prompts" "$SESSION_DIR/scripts" "$SESSION_DIR/logs"
```

## Agent Fleet Quality Checklist

Use this checklist before and during any Agent Fleet task pack generation.

| # | Checklist Item | Why It Matters | Gate |
|---|---------------|---------------|------|
| 1 | **Scope bounded** — One task per file or tightly coupled group | Reduces conflicts | Pre-draft |
| 2 | **Context complete** — Exact paths, constraints, verification steps | Runnable handoff | Draft |
| 3 | **Output expectations** — Clear success/failure criteria | Enables verification | Draft |
| 4 | **Log files configured** — tee or redirect for all outputs | Reproducibility | Draft |
| 5 | **No-commit default** — Human review before any commit | Safety | Draft |
| 6 | **Session folder created** — `.tmp/YYYYMMDDTHHMMSS-agent-fleet-<slug>/` | Naming convention | Pre-draft |
| 7 | **Execution hygiene** — Conflict grouping, final verification planned | Coordination | Draft |
| 8 | **Pack reviewed** — All prompts readable and executable | Quality gate | Closeout |

### Quality Tiers

| Tier | Criteria | Use When |
|------|----------|----------|
| **Minimal** | Items 1-3, 6 | Single task |
| **Standard** | Items 1-5, 6, 8 | Multi-task pack |
| **Full** | All 8 items | Parallel execution |

### Pre-Draft Verification

```
□ Scope bounded to one file or tightly coupled group
□ Context includes exact paths and constraints
□ Verification steps defined
□ Output expectations clear
□ No-commit default understood
□ Session folder naming correct
```

## Agent Fleet Consistency Validator

Before finalizing, verify:

### Consistency Check Matrix

| Check | What to Verify | How to Fix |
|-------|---------------|------------|
| **Scope vs Bundling** | One file or tightly coupled group per task | Split tasks |
| **Context vs Assumption** | Exact paths and constraints included | Add context |
| **Log vs tee** | tee used for output visibility and persistence | Add tee |
| **Commit vs Review** | No-commit default unless explicitly requested | Add warning |

### Red Flags (Never Present)

- [ ] One task fixing many unrelated files
- [ ] Missing verification steps
- [ ] Agents committing without human review
- [ ] No log files configured
- [ ] Arbitrary session folder naming

## Non-Negotiable Policy

Load `references/non-negotiable-policy.md` when: you are about to generate a
pack, write or review a worker prompt, or audit a runner script. Every rule
below must hold in the generated output — open the reference for the full
phrasing, rationale, and corner cases before deviating.

Summary of the 25 binding rules:

1. **Generate by default; run only on explicit request.**
2. **Default no commit / no push.**
3. **One bounded task per conflict unit** (usually one file per prompt).
4. **Every task is standalone** — embed enough context to act without the chat.
5. **Use exact paths** for files, packages, and verification.
6. **Preserve output logs** with `2>&1 | tee <log>`.
7. **Verify CLI flags live** with `agent --help` and `agent models`.
8. **No destructive automation** (no branch deletes, resets, pushes, commits).
9. **Surface residual gates** with final verification commands.
10. **Use timestamped session folders** `.tmp/<timestamp>-agent-fleet-<purpose-slug>/`.
11. **Name the standards files** the worker must consult — no generic "follow standards".
12. **Preserve strong documentation**; improve stale docs, never delete useful ones.
13. **Allow delegated exploration** via read-only subagents when uncertainty exists.
14. **Complex-refactor safety protocol** — improve safely, require pre-edit safety
    assessment, mandate `.tmp/.../backups/<task-id>/...` before-file copy for
    `sonarjs/cognitive-complexity`, `max-lines`, and any large single-file refactor.
15. **`--concurrency off` for all generated ESLint verification.**
16. **Narrow worker verification** (`--worker-verification lint-only`) for
    high-concurrency lint fleets; keep broad gates in `COMMANDS.md`.
17. **Review agent output before declaring success** — exit codes are not enough.
18. **Preflight stale local agents** (`vm_stat`, top RSS `ps`) before rerunning.
19. **Traceable refactor-derived filenames** — shared domain prefix; ban
    `types.ts`, `helpers.ts`, `utils.ts`, `constants.ts`, `state.ts`, `schema.ts`.
20. **Verify extracted TypeScript families**, not just the original target.
21. **Forbid parking-lot modules** — every new file must also stay under the threshold.
22. **Prefer semantic slices** over `base/tail`, `batch-XX`, or concern-list splits;
    keep public paths via a thin facade.
23. **Treat import/export wiring as first-class review risk** in TS extractions.
24. **Use ESLint evidence, not raw `wc -l`**, for `max-lines` acceptance.
25. **Make extracted docs part of file-size work**; ban new
    `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any` shortcuts.

## Workflow

The 10-step workflow is documented end-to-end in
`references/workflow-deep-dive.md`. Load that file when you are actively
generating a pack — it includes the route-classification table, inventory
gathering rules, task-boundary heuristics, full prompt anatomy, generator
invocations for routes A/B/C, runner templates, batch-runner conventions, the
run-and-monitor protocol, and final verification patterns.

This SKILL.md keeps a checklist-style summary of the same 10 steps so the agent
knows when to consult the deep dive vs. when to act.

### 1. Classify the requested generation route

Load `references/workflow-deep-dive.md` (section 1) when: the input does not
obviously map to one of the three generator routes below.
Summary: pick the route first, then the output shape. Routes are
**A — ESLint JSON** (`generate-eslint-agent-fleet-pack.ts`),
**B — ESLint inventory markdown** (`generate-eslint-inventory-agent-fleet-pack.ts`),
**C — Generic manifest** (`generate-manifest-agent-fleet-pack.ts`). ESLint is not
the default for browser tests, typecheck investigations, docs cleanup, or
migration validation — those use Route C or manual prompts.

### 2. Gather task inventory

Pull from immediate request, conversation summary, `.tmp/` gate logs,
`git status`/`git diff --name-only`, package lint/typecheck output, or a manual
file list. For each task record: task ID, slug, target package, exact file
scope, exact failure or desired change, allowed adjacent files, standards/docs
paths, doc-preservation needs, refactor-safety needs, backup path,
verification commands, and expected final response fields.

For ESLint tasks, use focused per-file verification with `--concurrency off`;
do not pipe `npm run lint` (which expands to `--concurrency auto`) into worker
prompts. Full details in `references/workflow-deep-dive.md` (section 2).

### 3. Design task boundaries

Load `references/workflow-deep-dive.md` (section 3) when: a task involves
cognitive-complexity, `max-lines`, mixed-responsibility files, or a multi-pack
ratchet.
Summary: one file per task for lint/docs/small refactors; one config unit per
task for ESLint/TSConfig/package config crashes; one feature slice per task only
when files are tightly coupled. Never run parallel agents against the same file
or fragile config. For cognitive-complexity, "improve safely" beats "fully
eliminate the warning."

### 4. Write each Agent Fleet prompt

Every prompt must include these 11 sections in order:

1. Title
2. Context / objective
3. Required local standards references (concrete file paths)
4. Documentation preservation instructions
5. Refactor-derived file naming
6. Delegated exploration allowance
7. Complex-refactor safety protocol
8. Scope constraints
9. Expected approach or hints
10. Verification commands (`--concurrency off` for ESLint)
11. Final response contract

Authoritative schema lives in `references/prompt-schema.md`. Long-form guidance
for documentation preservation, delegated exploration, complex-refactor safety
protocol, and refactor-derived file naming lives in
`references/workflow-deep-dive.md` (section 4).

### 5. Choose the session directory

Use a fresh timestamped folder for each generated pack:

```bash
SESSION_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<purpose-slug>"
mkdir -p "$SESSION_DIR/prompts" "$SESSION_DIR/scripts" "$SESSION_DIR/logs"
```

Rules: timestamp first, UTC sortable (`YYYYMMDDTHHMMSSZ`), literal `agent-fleet`
segment, dash-separated, short purpose slug last.

### 6. Prefer the pack-generation scripts when the input is structured

Load `references/workflow-deep-dive.md` (section 6) when: you need full
generator flag references, manifest JSON shapes, or the full list of files each
generator produces.
Summary:

- **Route A** — `generate-eslint-agent-fleet-pack.ts` for ESLint JSON inputs.
- **Route B** — `generate-eslint-inventory-agent-fleet-pack.ts` for curated
  `.eslint-inventory/generated` markdown.
- **Route C** — `generate-manifest-agent-fleet-pack.ts` for non-ESLint work
  driven by a small JSON manifest.

All three create the same scaffolding: `prompts/`, `backups/`, per-task
`scripts/run-<TASK_ID>.sh`, sequential and (when enabled) package-parallel /
bounded runners, `tasks.tsv`, `scripts/pack-status.py`, `run-status.sh`,
`logs/`, TSV summaries, and `COMMANDS.md`.

Generated runners share a Cursor CLI startup lock to avoid
`~/.cursor/cli-config.json` startup races and emit colorized launch/completion
banners.

### 7. Generate shell runners manually when no script input fits

When no generator fits, write a per-task script that captures output with `tee`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
agent -p --trust --force --model composer-2 --workspace "$PWD" \
  "$(cat $SESSION_DIR/prompts/<TASK_ID>.md)"
```

Invoke with `2>&1 | tee $SESSION_DIR/logs/<TASK_ID>.out`. Full templates in
`references/runner-templates.md`.

### 8. Generate batch runners when requested

Sequential runners: one task at a time, one log per task, TSV exit-code summary,
continue on failure unless fail-fast was requested, print final review commands.

Parallel runners: group non-overlapping tasks, use `&` and `wait` or the
generated bounded scheduler, avoid same-file or same-config collisions, keep one
`tee` log per task.

Bounded mode is only appropriate when every task has a distinct target file and
the work is low-collision (typically docs-only). Standard caps: 10 total / 4 per
package / 10s launch gap. Do not use bounded mode for cross-file refactors,
package-config edits, lockfile edits, route rewrites, or migrations. Full
guidance plus runner-template details in
`references/workflow-deep-dive.md` (section 8) and `references/runner-templates.md`.

### 9. Run and monitor when requested

Load `references/workflow-deep-dive.md` (section 9) when: the user has
explicitly asked to run a generated pack and you need the full
before-launch / during-execution / after-completion protocol with diff review
and memory-anomaly handling.
Summary: explicit opt-in only. Before launching, confirm pack/runner, preflight
memory (`vm_stat` + top RSS `ps`), pick the safest runner, start a lightweight
monitor. During execution, heartbeat status, watch `run-status.sh`, watch for
duplicate target files or cap overruns, do not kill processes without
authorization. After completion, run `run-status.sh --examples 3`, diff every
changed file, distinguish fleet edits from pre-existing drift, summarize
done/failed/pending plus anomaly evidence, keep no-commit/no-push intact.

A concurrency-1 retry that hits the same memory threshold is evidence of
stale-process pressure, not safety — pause and investigate instead of retrying.

### 10. Final verification plan

Always include:

```bash
git status -sb
npm run type-check
npx eslint --concurrency off --format stylish <package-or-target>
```

For root-owned platform packs, avoid `npx eslint .` (research/sandbox trees may
hold incomplete configs) — see `references/workflow-deep-dive.md` (section 10)
for the explicit platform-scoped command. Package-local equivalents apply for
submodule packs. List operator-only broad gates separately and warn when they
expand to `--concurrency auto`.

## Prompt Generation Checklist

Before handing off the generated pack, verify:

- [ ] every task has a unique ID,
- [ ] every prompt has exact file scope,
- [ ] every prompt says do not commit and do not push,
- [ ] every prompt includes concrete standards file paths when editing code,
- [ ] every prompt that may touch docs/comments includes documentation-preservation guidance,
- [ ] every prompt allows delegated read-only exploration/subagents for uncertainty resolution,
- [ ] every cognitive-complexity or large-refactor prompt asks for pre-edit safety assessment/subagent consultation and uses "improve safely" language instead of "resolve at all costs" language,
- [ ] every file-splitting or `max-lines` prompt requires traceable extracted-file naming with a shared domain prefix, forbids bare generic extracted filenames, and prefers semantic `domain-role` slices plus thin facades over `batch`/`segment`/`base`/`tail` or concern-list files,
- [ ] every large single-file refactor prompt includes an exact `.tmp/.../backups/<task-id>/...` backup command and says not to stage/commit the backup,
- [ ] every command uses `--workspace "$PWD"`,
- [ ] every command saves logs with `2>&1 | tee`,
- [ ] every generated ESLint verification command uses `--concurrency off` and avoids package scripts that force `--concurrency auto`,
- [ ] output uses a fresh `.tmp/<timestamp>-agent-fleet-<purpose-slug>/` folder,
- [ ] sequential/parallel scripts are executable,
- [ ] bounded packs include executable `run-status.sh` and `scripts/pack-status.py`,
- [ ] `COMMANDS.md` tells the operator how to run pack status/progress checks,
- [ ] final verification commands are listed,
- [ ] output paths are under the timestamped `.tmp/` session folder unless the user requested otherwise.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Generated command edits nothing | Missing `--force` in print mode | Add `--force` or `--yolo` if broad permissions are intended |
| Agent cannot find files | Wrong workspace or relative paths | Add `cd "$(git rev-parse --show-toplevel)"` and `--workspace "$PWD"` |
| Logs are missing errors | stderr was not captured | Use `2>&1 | tee <log>` |
| Parallel run corrupts/conflicts | Tasks touched same file/config | Regroup sequentially or isolate with worktrees |
| Agent commits unexpectedly | Prompt omitted no-commit policy | Add explicit "Do not commit. Do not push." to every task |
| Model ID fails | Model list changed or account lacks access | Run `agent models` and update generated scripts |
| Operator cannot tell what is done | Missing status helper or status files | Bounded packs must include `run-status.sh`; each task writes `logs/status/<TASK_ID>.status.tsv` |

## Common Pitfalls

1. **Generating a prose plan instead of runnable files.** The expected output is a
   task pack with prompts and shell commands.
2. **Omitting exact verification.** The worker should know which command proves
   the bounded task is done.
3. **Over-broad scopes.** "Fix all UI lint" creates conflicts and vague changes;
   split by file or config unit.
4. **Forgetting final gate commands.** Individual task lint can pass while the
   repo-wide gate still fails.
5. **Not preserving output.** Without `tee`, later review loses the agent's report
   and command output.
6. **Letting generated scripts commit.** Default output should stop before staging,
   committing, or pushing.
7. **Ignoring local standards.** Code-editing tasks should include concrete local
   coding-pattern and documentation-standard paths, not just the failing lint line.
8. **Degrading useful docs.** Workers sometimes delete detailed comments to make a
   file shorter; prompts must tell them to preserve truthful documentation and only
   replace stale, misleading, or non-compliant content.
9. **Discouraging investigation.** If a prompt forbids exploration too strongly,
   workers may guess. Allow read-only subagents/delegation for caller discovery,
   standards lookup, and convention checks while keeping edits bounded.

## Cross-Skill Coordination

### Use together with

- Cursor headless guidance when verifying current `agent` CLI flags, output modes,
  auth, model IDs, or sandbox behavior.
- Handoff prompt guidance when the user wants generic handoff briefs not tied to
  Agent Fleet shell-runner generation.
- Task orchestration guidance when the user wants dependency-aware, reviewed,
  worktree-based execution rather than ad hoc Agent Fleet runs.

## Local Corpus Layout

The `references/` directory is flat:

- `quick-commands.md` — copy/paste catalog of session-dir, generator, runner, and
  final-verification commands. Load when you need exact invocation syntax.
- `non-negotiable-policy.md` — full long-form text of all 25 binding policy rules
  with rationale and corner cases. Load before generating a pack, writing a
  worker prompt, or auditing a runner script.
- `workflow-deep-dive.md` — full detail of the 10 workflow steps (route
  classification table, inventory rules, boundary heuristics, prompt anatomy,
  generator routes A/B/C, runner templates, batch runners, run-and-monitor
  protocol, final verification). Load when actively building or running a pack.
- `prompt-schema.md` — required sections and exact wording for each Agent Fleet
  task prompt. Load when writing or reviewing prompt content.
- `runner-templates.md` — executable script, command, sequential runner, and
  parallel batch templates. Load when assembling shell runners by hand.
- `task-splitting.md` — how to convert context or gate output into bounded tasks.
  Load when scoping an unstructured backlog into runnable Agent Fleet tasks.
- `brainstorming-workflow.md` — multi-wave analysis workflow for exploring codebase
  systems and identifying abstraction opportunities through diverse agent biases.
  Use for discovery phases where the goal is insight, not code changes.

The `scripts/` directory contains dependency-free TypeScript helpers:

- `generate-eslint-agent-fleet-pack.ts` — CLI that converts ESLint JSON reports into
  timestamped Agent Fleet packs with prompts, task scripts, sequential runners,
  package-parallel runners, logs folders, summaries, and `COMMANDS.md`.
- `generate-eslint-inventory-agent-fleet-pack.ts` — CLI that converts generated
  `.eslint-inventory/generated` markdown file-batch pages into runnable packs,
  preserving inventory/fix-pattern context in prompts.
- `generate-manifest-agent-fleet-pack.ts` — CLI that converts a generic inferred/manual
  task manifest into the same runnable pack scaffolding for non-ESLint work.
- `agent-fleet-pack-lib.ts` — shared library used by generators to render prompts,
  shell runners, package grouping, rule-specific guidance, standards references,
  and final verification commands.

Generated bounded runners use `caffeinate -ims` on macOS when available, so the computer stays awake without forcing the display to stay on. Set `NO_COLOR=1` to disable ANSI colors.

Bounded packs include `run-status.sh`, which reports done/failed/pending counts by package, examples, and active scheduler/agent processes. Treat this as a required deliverable for any generated bounded pack, not an optional convenience.

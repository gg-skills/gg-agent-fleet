---
title: Agent Fleet Workflow — Deep Dive
---

# Agent Fleet Workflow — Deep Dive

The SKILL.md keeps a checklist-style summary of the 10 workflow steps. This file
holds the full detail: route-classification tables, gather-inventory rules, task
boundary heuristics, prompt anatomy, generator usage for routes A/B/C, shell
runner templates, batch runner conventions, run-and-monitor protocol, and final
verification command patterns.

Load this file when actually building a pack — not for a quick lookup of the
non-negotiable policy.

---

## 1. Classify the requested generation route

Choose the route first, then the output shape:

| Request/input pattern | Preferred route | Output |
|-----------------------|-----------------|--------|
| Fresh ESLint JSON reports are available | `generate-eslint-agent-fleet-pack.ts` | timestamped pack with prompts, scripts, package sequential runners, package-parallel runner, logs, summaries, `COMMANDS.md` |
| Curated `.eslint-inventory/generated` markdown exists or should be refreshed | `npm run eslint:inventory`, then `generate-eslint-inventory-agent-fleet-pack.ts` | same runnable pack, with inventory pages/fix-pattern context embedded in prompts |
| Documentation-only one-file-per-task backlog, especially JSDoc warnings | ESLint or manifest generator with `--parallel bounded --max-total-agents 10 --max-package-agents 4 --agent-launch-delay-seconds 10` | bounded high-concurrency pack with duplicate-target protection, max 10 active agents total, max 4 per package, and 10 seconds between launches |
| Cognitive complexity or large behavior-sensitive readability work | ESLint or manifest generator with conservative bounded caps, or sequential runner for the riskiest files | one file per task with "improve safely" objective, pre-edit safety/subagent assessment, and `.tmp/.../backups/<task-id>/...` before-file copy for large refactors |
| File length / `max-lines` readability work | ESLint JSON route with `--only-rule max-lines --include-warnings`, package-sequential/sequential execution by default after failed or behavior-sensitive attempts, conservative bounded caps only for unique low-risk files, and `--worker-verification lint-only` | one file per task with modularity-first guidance, unconditional before-file backup, documentation preservation, traceable domain-slice naming, no parking-lot/base-tail modules, lint on every touched implementation file, and explicit typecheck-run/deferred reporting |
| Progressive quality ratchet campaign | ESLint JSON route plus an external campaign skill/runbook that owns threshold selection and review gates | repeated timestamped packs, each tied to one measured threshold and accepted only after post-run diff review |
| Non-ESLint work can be expressed as structured tasks | write a small JSON manifest, then run `generate-manifest-agent-fleet-pack.ts` | same timestamped pack/scaffolding as ESLint route |
| Unstructured conversation/gate context only | infer task inventory, preferably write a manifest, then use manifest generator | durable generated pack instead of hand-written shell scaffolding |
| Highly custom task boundaries or unusual execution | manually write prompts/scripts using references | timestamped `.tmp/<timestamp>-agent-fleet-<purpose-slug>/` |
| "Give me commands" only | emit command list with `tee` output paths | no generated files unless requested |

Do not treat ESLint as the default for all requests. Functional browser testing,
typecheck investigation, docs cleanup, migration validation, API behavior checks,
smoke tests, and semantic code review should use the generic manifest route or
manual prompt generation.

## 2. Gather task inventory

Use the freshest available source of truth:

- immediate user request,
- current conversation summary,
- gate logs under `.tmp/`,
- `git status` / `git diff --name-only`,
- package lint/typecheck output,
- manually supplied file list.

For each task, record:

- task ID and short slug,
- target repo/package,
- exact file scope,
- exact failure or desired change,
- allowed adjacent files, if any,
- exact standards/docs files to read, including coding patterns and documentation standards,
- documentation preservation requirements,
- whether the task may require the complex-refactor safety protocol,
- whether extracted files need a shared domain prefix instead of generic names,
- backup path instructions for any large single-file refactor,
- verification commands,
- expected final response fields.

For ESLint-backed tasks, prefer focused verification commands that lint only the
target file with concurrency disabled, for example:

```bash
(cd <package-path> && npx eslint --concurrency off --format stylish <package-relative-file>)
```

Avoid `npm run lint` inside worker prompts when that script includes
`--concurrency auto`; repeated full-package concurrent ESLint runs can multiply
parser/plugin memory across many agents.

When another skill or runbook owns a progressive quality campaign (for example a
cognitive-complexity threshold ratchet), treat Agent Fleet as the pack/execution
substrate only. Keep threshold choice, offender-count interpretation, and
acceptance criteria in the campaign skill, but make each generated pack durable:
include the threshold number in the purpose slug, preserve the source ESLint JSON
paths in prompts, and require post-run review before a later pack lowers the
threshold again.

## 3. Design task boundaries

Use these grouping rules:

- **One file per task** for lint, docs, small refactors, and React hook fixes.
- **One config unit per task** for ESLint/TSConfig/package config crashes.
- **One feature slice per task** only when files are tightly coupled.
- Do not run parallel agents against the same file or the same fragile config.
- Put broad/global verification in a final review step, not inside every task.
- For cognitive-complexity work, prefer "make the safest meaningful improvement"
  over "fully eliminate the warning" unless the function is small and behavior is
  obvious. Treat full warning elimination as a nice outcome, not a mandate.
- For large single-file refactors, lower concurrency and require a backup-based
  before/after review path instead of treating the task like routine lint cleanup.
- For `max-lines` and file-size packs, use the active ESLint diagnostics as the
  acceptance source of truth; raw `wc -l` is triage only because blank/comment
  skipping can make physical counts misleading.
- After a failed or reverted `max-lines` attempt, regenerate or rerun with
  sequential/package-sequential execution and include a post-run polish/review
  task instead of immediately returning to high-concurrency execution.
- For declarative field matrices, registries, overloaded clients, or other
  mixed-responsibility files, ask workers to keep the original public boundary in
  a small aggregator/facade and extract semantic slices (`foundation`,
  `commerce-feedback`, `landing-localization`, `transactional-email-previews`,
  etc.) rather than arbitrary `batch`, `segment`, `base`/`tail`, or concern-list
  halves. Review the slice names and sizes as part of acceptance.
- For multi-pack ratchets, generate one pack per threshold and do not mix files
  from different threshold measurements in the same run; otherwise reviewers lose
  the ability to map each diff back to the lint evidence that justified it.

## 4. Write each Agent Fleet prompt

Every prompt must include these sections:

1. Title
2. Context / objective
3. Required local standards references with concrete file paths
4. Documentation preservation instructions
5. Refactor-derived file naming
6. Delegated exploration allowance
7. Complex-refactor safety protocol
8. Scope constraints
9. Expected approach or hints
10. Verification commands
11. Final response contract

Use the schema in `references/prompt-schema.md`.

ESLint verification commands in generated prompts must explicitly include
`--concurrency off`. If a manifest or gate report supplies `npm run lint`, replace
or annotate it with a focused no-concurrency ESLint command before handing the
pack to workers.

### Documentation preservation instructions

When a generated task may touch code comments, file overviews, JSDoc, README
content, or domain documentation, include explicit guidance that the worker must:

- keep existing thorough and truthful documentation unless it is stale or wrong,
- improve documentation quality rather than shortening it for convenience,
- update comments to match code changes,
- add concise intent comments for non-obvious code paths,
- ensure every function has an explanatory block comment when local standards require it,
- add a catch-block behavior comment where error handling is non-obvious.

### Delegated exploration allowance

When a task has ambiguous types, unknown callers, unclear conventions, or risky
behavioral implications, include explicit guidance that the worker may use
available subagents or delegated read-only helpers to investigate. The prompt
should encourage this for thoroughness, but still require the final edits to stay
inside the declared scope unless the worker stops and reports why broader edits
are necessary.

### Complex-refactor safety protocol

When a task involves `sonarjs/cognitive-complexity`, large functions, JSX/control
flow extraction, async orchestration, error handling, or other behavior-sensitive
readability refactors, generated prompts must include a safety protocol:

- tell the worker that the goal is to improve readability and reduce cognitive
  complexity safely, not to force the diagnostic to disappear at any cost,
- before editing, ask the worker to use available read-only subagents/delegated
  helpers to propose the safest simplifications; when subagents are unavailable,
  require a short written pre-edit safety assessment instead,
- prefer small pure-helper extraction, named predicates, early-return cleanup, and
  local data-shaping helpers over broad control-flow rewrites,
- forbid changing async ordering, error propagation, public contracts, runtime
  side effects, or UI/event ordering unless the task explicitly requires it,
- require the worker to stop and report risk instead of making a speculative
  refactor when the safe path is unclear,
- for every `sonarjs/cognitive-complexity` task, require a
  `.tmp/.../backups/<task-id>/...` copy of the current file before editing even
  if the worker expects a small change; for non-cognitive large single-file
  refactors, require the same backup once large/risky scope is possible. Use
  that backup for self-review or read-only subagent comparison of the before/after
  behavior.
- for every `max-lines` task, require the same before-file backup
  unconditionally before editing. File-length fixes are inherently refactor-prone
  even when the worker expects to extract only small pure helpers.

The generated prompt should provide an exact backup command, for example:

```bash
mkdir -p .tmp/<session>/backups/<TASK_ID>
cp <repo-relative-target-file> .tmp/<session>/backups/<TASK_ID>/<safe-target-name>.before
```

The backup is an untracked review artifact only. Do not stage it, commit it, or
edit it after the implementation starts.

### Refactor-derived file naming

When a generated task may split a file or create extracted modules, include
filename guidance:

- extracted files must share a stable, domain-specific prefix that identifies the
  original concern or component;
- avoid bare generic filenames such as `types.ts`, `helpers.ts`, `utils.ts`,
  `constants.ts`, `state.ts`, or `schema.ts`;
- prefer traceable families such as `profile-canvas-renderer-types.ts`,
  `profile-canvas-renderer-helpers.ts`, and
  `profile-canvas-renderer-validation.ts`;
- when a file has accumulated multiple responsibilities, prefer cohesive
  `domain-role` slices plus a small compatibility facade over a single extracted
  filename that lists every concern;
- avoid extraction-mechanics labels such as `batch-01`, `segment-03`, `base`,
  `tail`, `part-a`, or `part-b` unless those words are actual domain vocabulary;
- keep existing public exports stable where practical, and explain any adjacent
  barrel/index edits in the final response.

## 5. Choose the session directory

Use a fresh timestamped folder for each generated pack:

```bash
SESSION_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<purpose-slug>"
mkdir -p "$SESSION_DIR/prompts" "$SESSION_DIR/scripts" "$SESSION_DIR/logs"
```

Rules:

- timestamp comes first,
- use UTC sortable format such as `YYYYMMDDTHHMMSSZ`,
- include literal `agent-fleet`,
- append a short purpose slug,
- separate every segment with dashes,
- write prompts, scripts, logs, command docs, and summaries inside that folder.

## 6. Prefer the pack-generation scripts when the input is structured

### Route A: ESLint JSON

When the task inventory comes from ESLint JSON, use the ESLint generator instead of
reconstructing runner scaffolding from memory:

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
  --purpose <purpose-slug> \
  --input <package>=<eslint-json> \
  --parallel package
```

Use `--parallel bounded --max-total-agents 10 --max-package-agents 4 --agent-launch-delay-seconds 10` for broad
one-file-per-task packs where concurrent edits are safe, especially documentation-only
work such as JSDoc backfills. Bounded mode refuses duplicate target files so two
agents do not edit the same file at the same time.

Use `--exclude-rule` and `--excluded-rule-note` for intentional non-goals, such as
placeholder/extension-point types that should remain allowed.

### Route B: Generated ESLint inventory markdown

When the repository has curated inventory artifacts under `.eslint-inventory/generated`,
or when the user asks for packs from "the ESLint inventory," refresh or consume that
inventory and use:

```bash
npm run eslint:inventory
npx tsx skills/agent-fleet/scripts/generate-eslint-inventory-agent-fleet-pack.ts \
  --inventory-root .eslint-inventory/generated \
  --purpose eslint-inventory-cleanup \
  --severity all \
  --parallel package
```

Use bounded parallelism for inventory-derived documentation packs or other clearly
one-file-per-task cleanup:

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-inventory-agent-fleet-pack.ts \
  --inventory-root .eslint-inventory/generated \
  --purpose eslint-inventory-docs-cleanup \
  --severity warning \
  --parallel bounded \
  --max-total-agents 10 \
  --max-package-agents 4 \
  --agent-launch-delay-seconds 10
```

Use `--package <name>` to limit scope and `--severity warning` or `--severity error`
to select files that contain a severity. Because inventory tasks are file batches,
selected files include all findings in that file so focused verification can pass.

### Route C: Generic manifest for non-ESLint packs

When work is not ESLint-specific, infer or ask for a manifest, then use:

```bash
npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \
  --manifest .tmp/<purpose>-agent-fleet-pack-manifest.json
```

Manifest tasks can represent browser smoke checks, functional sanity testing,
typecheck fixes, docs audits, migration reviews, API behavior checks, or manually
scoped code cleanup. Set `"parallelStrategy": "bounded"`, `"maxConcurrentTasks": 10`,
and `"maxConcurrentTasksPerPackage": 4` for documentation-only manifests with one
unique target file per task.

Minimal manifest shape:

```json
{
  "purpose": "browser-functional-sanity",
  "parallelStrategy": "package",
  "contextNote": "Standalone context shared by every generated prompt.",
  "packages": {
    "ui-package": {
      "packagePath": "ui-package",
      "finalVerificationCommands": ["cd ui-package && npx eslint --concurrency off --format stylish .", "cd ui-package && npm run ts:check"]
    }
  },
  "tasks": [
    {
      "packageName": "ui-package",
      "repoRelativePath": "ui-package/app/(with-sidebar)/app/page.tsx",
      "taskKind": "browser-smoke",
      "objective": "Verify /app route behavior and fix scoped regressions if found.",
      "requirements": ["Use browser or curl to verify the route is not a 404."],
      "verificationCommands": ["cd ui-package && npm run ts:check"]
    }
  ]
}
```

All generators create:

- `prompts/<TASK_ID>.md`,
- `backups/` for optional before-file copies created by workers during large
  single-file refactors,
- `scripts/run-<TASK_ID>.sh`,
- `run-<package>-sequentially.sh`,
- `run-all-sequentially.sh`,
- `run-packs-parallel.sh` when package parallelism is enabled,
- `run-parallel-bounded.sh`, `run-<package>-parallel-bounded.sh`, `tasks.tsv`,
  `scripts/bounded-scheduler.py`, `scripts/pack-status.py`, and `run-status.sh` when
  bounded parallelism is enabled,
- a shared startup lock around Cursor CLI launch so parallel agents preserve the
  operator's login while avoiding `~/.cursor/cli-config.json` startup races,
- colorized launch/completion console banners that show task ID, target file, prompt path, exact agent command, full prompt text, exit code, and log path,
- colorized scheduler progress footers after task launch, prompt send, task completion, and final summary, including active lane/task labels,
- `logs/`, TSV summaries, and `COMMANDS.md`.

## 7. Generate shell runners manually when no script input fits

For each prompt, generate an executable script:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
agent -p --trust --force --model composer-2 --workspace "$PWD" \
  "$(cat .tmp/<timestamp>-agent-fleet-<purpose-slug>/prompts/<TASK_ID>.md)"
```

Then generate a command that records output:

```bash
.tmp/<timestamp>-agent-fleet-<purpose-slug>/scripts/run-<TASK_ID>.sh \
  2>&1 | tee .tmp/<timestamp>-agent-fleet-<purpose-slug>/logs/<TASK_ID>.out
```

## 8. Generate batch runners when requested

Sequential runners should:

- run tasks one at a time,
- write one log file per task,
- capture exit codes in a TSV summary,
- continue after individual task failures unless the user asked for fail-fast,
- print final review commands.

Parallel runners should:

- group non-overlapping tasks,
- use `&` and `wait`, or the generated bounded scheduler,
- avoid same-file or same-config collisions,
- keep one `tee` log per task.

Bounded parallel runners are preferred when all of these are true:

- every task has a distinct target file,
- the work is documentation-only or otherwise low-collision and behavior-preserving,
- the user wants higher throughput,
- the pack should cap active agents, usually 10 total, 4 per package, and 10 seconds between launches.

Generated task runners use the operator's real `HOME` so `agent login` state remains available. The current Cursor-backed runners serialize only the initial CLI startup window with `.agent-cli-startup.lock` to avoid parallel writes to `~/.cursor/cli-config.json`. Tune the startup window with `AGENT_FLEET_AGENT_STARTUP_LOCK_SECONDS` if needed.

Do not use bounded mode for cross-file refactors, package config edits, lockfile edits,
route rewrites, migrations, or any work where multiple files must be coordinated by one
agent. For cognitive-complexity refactors, bounded mode is acceptable only with
low caps, unique target files, and the complex-refactor safety protocol in every
prompt; otherwise prefer sequential execution.

## 9. Run and monitor when requested

If the user explicitly asks you to run the generated Agent Fleet pack, you may
execute the generated runner instead of only handing off commands. This is an
opt-in path; do not infer permission from generation requests alone.

Before launching:

- confirm the exact pack directory and runner you are about to use,
- prefer `run-status.sh` once before launch to verify pending/done counts,
- run a stale-process memory preflight (`vm_stat` plus top RSS `ps` sample) before
  starting or rerunning local workers,
- if stale MCP/LSP/agent processes are already using multi-GB RSS, record the
  evidence and do not launch until the operator cleans them up, authorizes
  cleanup, or explicitly accepts a lower-cap/manual fallback,
- prefer the safest runner that satisfies the request (`run-all-sequentially.sh`
  for maximum safety, or bounded parallel only when the pack has unique target
  files and conservative caps),
- start a lightweight monitor that samples process count, top RSS, available
  memory, and pack status while the runner is active,
- capture runner output with the pack's existing `tee` logs, and capture monitor
  samples under a timestamped `.tmp/...-agent-fleet-monitor/` directory.

During execution:

- heartbeat to the user with concise status updates instead of going silent,
- watch `run-status.sh` for done/failed/pending counts,
- watch for unexpected extra runners, duplicate target files, or more active
  agents than the pack's configured caps,
- call out memory anomalies such as available memory dropping below a safe floor,
  a single process growing unexpectedly, or repeated ESLint spikes that do not
  release,
- do not kill or reset processes unless the user explicitly asks, except when a
  process is clearly orphaned from a completed/cancelled runner and the user has
  authorized cleanup.

After completion:

- run `run-status.sh --examples 3`,
- review every file changed by the fleet before reporting success:
  - compare `git status --short` before/after when available,
  - inspect focused `git diff` for each target file and confirm it matches the
    worker prompt, final response, and intended scope,
  - flag any adjacent or unexpected file edits instead of silently accepting them,
  - check that behavior-preserving lint refactors do not alter public contracts,
    async ordering, generated artifacts, package manifests, lockfiles, or runtime
    semantics unless those changes were explicitly in scope,
  - for file-size packs, confirm no `max-lines` warnings remain or list explicit
    partials, check no new TypeScript/ESLint suppressions were introduced, and
    run or list package typecheck/diff-check before declaring the result pristine,
  - verify extracted modules use meaningful domain-slice names and are not
    arbitrary `batch`, `segment`, `base`/`tail`, or `part-a`/`part-b` parking
    lots, and that compatibility facades stay thin,
  - check documentation warnings and JSDoc/file-overview coverage for newly
    extracted files before declaring documentation clean,
  - distinguish fleet-caused changes from pre-existing workspace drift,
- summarize done/failed/pending counts, runner log paths, monitor log paths, and
  any anomaly evidence,
- summarize the post-run sanity review result, including files reviewed and any
  concerns or scope deviations,
- list the final verification commands from `COMMANDS.md`, but do not run broad
  expensive package gates unless the user explicitly asks,
- keep the no-commit/no-push policy intact.

Do not retry a pack more than once after a memory stop without changing the
conditions that caused the stop. A concurrency-1 retry that hits the same memory
threshold is evidence of stale-process pressure, not evidence that another retry
will be safer.

## 10. Final verification plan

Always include final commands such as:

```bash
git status -sb
npm run type-check
npx eslint --concurrency off --format stylish <package-or-target>
```

For root-owned platform packs, avoid `npx eslint .`: the repo may contain research/sandbox trees
with independent incomplete ESLint configs. Use the platform-owned root scope instead while keeping
`--concurrency off`:

```bash
npx eslint --config eslint.config.ts --report-unused-disable-directives \
  --concurrency off --format stylish \
  scripts .pi/extensions skills eslint.config.ts jest.config.ts \
  .mcp.json .cursor/mcp.json .windsurf/mcp.json .vscode/mcp.json opencode.json
```

Use package-local equivalents where the task pack targets a submodule. If the
operator intentionally wants to run the package's canonical `npm run lint` script
after agents finish, list it as an optional broad gate and warn when it expands to
`--concurrency auto`; do not put that command in worker per-task verification.
